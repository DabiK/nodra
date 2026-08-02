import { createOpencodeClient, type AssistantMessage, type Event, type Part, type Provider } from "@opencode-ai/sdk";
import {
  deriveProviderHealth,
  ProviderProtocolIncompatibleError,
  type ProviderCapabilities,
  type ProviderExecutionResult,
  type ProviderExecutionSink,
  type ProviderModel,
  type ProviderPort,
  type ProviderProbeResult,
  type ProviderReasoningEffort,
  type ProviderRunConfiguration
} from "@nodra/application";
import { OpenCodeContractProbe } from "./opencode-contract-probe.js";
import { OpenCodeEventMapper } from "./opencode-event-mapper.js";
import { OpenCodeRunSupervisor } from "./opencode-run-supervisor.js";

const adapterVersion = "opencode-serve-http-v1";
const certifiedServerVersion = "1.18.5";
const certifiedSchemaDigest = "f5cb443f0d160fc4b17190f64c2401f199160eb2137ce4e00ca319b99aa34005";

export interface OpenCodeProviderAdapterOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  executionTimeoutMs?: number;
}

interface OpenCodePromptRequest {
  cwd: string;
  modelId: string;
  reasoningEffort: ProviderReasoningEffort;
  text: string;
}

export class OpenCodeProviderAdapter implements ProviderPort {
  readonly providerId = "opencode";
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly executionTimeoutMs: number;

  constructor(
    options: OpenCodeProviderAdapterOptions = {},
    private readonly supervisor = new OpenCodeRunSupervisor(),
    private readonly mapper = new OpenCodeEventMapper()
  ) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:4096").replace(/\/+$/, "");
    this.fetchImplementation = options.fetch ?? fetch;
    this.executionTimeoutMs = options.executionTimeoutMs ?? 300_000;
  }

  async probe(): Promise<ProviderProbeResult> {
    const probedAt = new Date().toISOString();
    let version: string | null = null;
    let digest: string | null = null;
    try {
      const contract = await new OpenCodeContractProbe(
        this.baseUrl,
        this.fetchImplementation
      ).execute();
      version = contract.version;
      digest = contract.digest;
      const required = Object.values(contract.requiredPrimitives).every(Boolean);
      const client = this.client();
      const models = await this.probeModels(client);
      const capabilities = this.capabilities(version, digest, required, models.length > 0);
      return {
        providerId: this.providerId,
        adapterVersion,
        binaryVersion: version,
        contractDigest: digest,
        authenticated: models.length > 0,
        authKind: "server_managed",
        health: deriveProviderHealth(capabilities),
        capabilities,
        models,
        probedAt
      };
    } catch (error) {
      const incompatible = version !== null && this.isContractError(error);
      const capabilities = this.capabilities(
        version,
        digest,
        !incompatible,
        false,
        this.safeReason(error)
      );
      return {
        providerId: this.providerId,
        adapterVersion,
        binaryVersion: version,
        contractDigest: digest,
        authenticated: false,
        authKind: null,
        health: deriveProviderHealth(capabilities),
        capabilities,
        models: [],
        probedAt
      };
    }
  }

  async execute(
    input: ProviderRunConfiguration,
    sink: ProviderExecutionSink
  ): Promise<ProviderExecutionResult> {
    if (input.providerId !== this.providerId) {
      throw new Error(`OpenCode adapter cannot execute provider ${input.providerId}`);
    }
    const client = this.client(input.cwd);
    const session = input.session
      ? (await client.session.get({
          path: { id: input.session.externalId },
          query: { directory: input.cwd },
          throwOnError: true
        })).data
      : (await client.session.create({
          body: { title: `Nodra run ${input.runId}` },
          query: { directory: input.cwd },
          throwOnError: true
        })).data;
    const stopEvents = new AbortController();
    this.supervisor.attach(input.runId, {
      sessionId: session.id,
      cwd: input.cwd,
      modelId: input.modelId,
      reasoningEffort: input.reasoningEffort,
      stopEvents
    });
    await sink.session(session.id);
    const runRef = `${session.id}/${input.runId}`;
    await sink.runRef(runRef);
    const subscribed = await client.event.subscribe({
      query: { directory: input.cwd },
      signal: stopEvents.signal
    });
    const terminal = this.consumeEvents(
      subscribed.stream as AsyncIterable<Event>,
      input,
      session.id,
      sink,
      client,
      stopEvents.signal
    );
    try {
      await this.promptAsync(session.id, {
        cwd: input.cwd,
        modelId: input.modelId,
        reasoningEffort: input.reasoningEffort,
        text: input.prompt
      });
      let timeout: NodeJS.Timeout | undefined;

      try {
        const timedOut = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            stopEvents.abort();

            reject(
              new Error(
                `OpenCode execution timed out after ${this.executionTimeoutMs}ms: ` +
                `runId=${input.runId} sessionId=${session.id} model=${input.modelId}`
              )
            );
          }, this.executionTimeoutMs);

          timeout.unref();
        });

        const state = await Promise.race([
          terminal,
          timedOut
        ]);

        return {
          state,
          externalSessionId: session.id,
          externalRunId: runRef
        };
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    } catch (error) {
      stopEvents.abort();
      if (error instanceof ProviderProtocolIncompatibleError) throw error;
      throw new ProviderProtocolIncompatibleError(
        error instanceof Error ? error.message : "OpenCode execution failed",
        this.providerId,
        input.capabilityVersion
      );
    } finally {
      this.supervisor.release(input.runId);
    }
  }

  async cancel(runId: string): Promise<void> {
    const active = this.supervisor.get(runId);
    if (!active) throw new Error("No active OpenCode session is available");
    const result = await this.client().session.abort({
      path: { id: active.sessionId },
      throwOnError: true
    });
    if (result.data !== true) throw new Error("OpenCode session abort was not acknowledged");
  }

  async steer(runId: string, text: string): Promise<void> {
    const active = this.supervisor.get(runId);
    if (!active) throw new Error("No active OpenCode session is available");
    await this.promptAsync(active.sessionId, {
      cwd: active.cwd,
      modelId: active.modelId,
      reasoningEffort: active.reasoningEffort,
      text
    });
  }

  private async consumeEvents(
    events: AsyncIterable<Event>,
    input: ProviderRunConfiguration,
    sessionId: string,
    sink: ProviderExecutionSink,
    client: ReturnType<OpenCodeProviderAdapter["client"]>,
    signal: AbortSignal
  ): Promise<ProviderExecutionResult["state"]> {
    for await (const event of events) {
      const mapped = this.mapper.map(event, sessionId, input.cwd);
      if (!mapped) continue;
      await sink.event(mapped.event);
      if (mapped.permission) {
        const decision = await sink.permission(mapped.permission);
        const response = await client.postSessionIdPermissionsPermissionId({
          path: { id: sessionId, permissionID: String(mapped.permission.requestId) },
          query: { directory: input.cwd },
          body: { response: decision === "approved" ? "once" : "reject" },
          throwOnError: true
        });
        if (response.data !== true) {
          throw new Error("OpenCode permission response was not acknowledged");
        }
      }
      if (mapped.failed) {
        await sink.event({
          type: "provider/executionCompleted",
          payload: { state: "FAILED", source: event },
          occurredAt: new Date().toISOString()
        });
        return "FAILED";
      }
      if (mapped.idle) {
        await this.persistAssistantResult(client, input.cwd, sessionId, sink);
        await sink.event({
          type: "provider/executionCompleted",
          payload: { state: "SUCCEEDED", source: event },
          occurredAt: new Date().toISOString()
        });
        return "SUCCEEDED";
      }
    }
    if (signal.aborted) return "CANCELLED";
    throw new Error("OpenCode event stream ended before a terminal session event");
  }

  private async persistAssistantResult(
    client: ReturnType<OpenCodeProviderAdapter["client"]>,
    directory: string,
    sessionId: string,
    sink: ProviderExecutionSink
  ): Promise<void> {
    const messages = await client.session.messages({
      path: { id: sessionId },
      query: { directory },
      throwOnError: true
    });
    const assistants = messages.data.filter(
      (message): message is { info: AssistantMessage; parts: Part[] } =>
        message.info.role === "assistant"
    );
    if (assistants.length === 0) {
      throw new Error("OpenCode session became idle without an assistant message");
    }
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let cost = 0;
    for (const assistant of assistants) {
      const tokens = assistant.info.tokens;
      input += tokens?.input ?? 0;
      output += tokens?.output ?? 0;
      cacheRead += tokens?.cache?.read ?? 0;
      cacheWrite += tokens?.cache?.write ?? 0;
      cost += assistant.info.cost ?? 0;
    }
    await sink.event({
      type: "provider/usageReported",
      payload: {
        tokenUsage: {
          total: {
            inputTokens: input,
            outputTokens: output,
            cachedInputTokens: cacheRead,
            cacheWriteInputTokens: cacheWrite
          }
        },
        costMicros: Math.round(cost * 1_000_000)
      },
      occurredAt: new Date().toISOString()
    });
    for (const assistant of assistants) {
      const text = assistant.parts
        .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("");
      if (!text.trim()) continue;
      await sink.event({
        type: "provider/assistantMessage",
        payload: {
          item: {
            id: assistant.info.id,
            type: "agentMessage",
            text
          }
        },
        assistantMessage: text,
        occurredAt: new Date().toISOString()
      });
    }
  }

  private client(directory?: string) {
    return createOpencodeClient({
      baseUrl: this.baseUrl,
      fetch: this.fetchImplementation,
      ...(directory ? { directory } : {})
    });
  }

  private async probeModels(client: ReturnType<OpenCodeProviderAdapter["client"]>): Promise<ProviderModel[]> {
    const catalog = await client.config.providers({ throwOnError: true });
    try {
      const listed = await client.provider.list({ throwOnError: true });
      const connected = new Set(listed.data.connected);
      const providers = catalog.data.providers.filter((provider) => connected.has(provider.id));
      const models = this.models(providers, catalog.data.default);
      const known = new Set(providers.map((provider) => provider.id));
      for (const provider of listed.data.all) {
        if (known.has(provider.id) || !connected.has(provider.id)) continue;
        for (const model of Object.values(provider.models)) {
          models.push({
            id: `${provider.id}/${model.id}`,
            displayName: `${provider.name} / ${model.name}`,
            description: `${provider.id} model exposed by OpenCode Serve`,
            hidden: model.status === "deprecated",
            isDefault: listed.data.default[provider.id] === model.id,
            supportedReasoningEfforts: model.reasoning
              ? ["provider_default", "high"]
              : ["provider_default"],
            defaultReasoningEffort: "provider_default"
          });
        }
      }
      return models;
    } catch {
      // GET /provider is optional; /config/providers models remain authoritative.
      return this.models(catalog.data.providers, catalog.data.default);
    }
  }

  private models(providers: Provider[], defaults: Record<string, string>): ProviderModel[] {
    return providers.flatMap((provider) =>
      Object.values(provider.models).map((model) => {
        const id = `${provider.id}/${model.id}`;
        const supportedReasoningEfforts = this.reasoningEfforts(model);
        return {
          id,
          displayName: `${provider.name} / ${model.name}`,
          description: `${provider.id} model exposed by OpenCode Serve`,
          hidden: model.status === "deprecated",
          isDefault: defaults[provider.id] === model.id,
          supportedReasoningEfforts,
          defaultReasoningEffort: "provider_default"
        };
      })
    );
  }

  private async promptAsync(
    sessionId: string,
    request: OpenCodePromptRequest
  ): Promise<void> {
    const model = this.parseModelId(request.modelId);
    const query = new URLSearchParams({ directory: request.cwd });
    const response = await this.fetchImplementation(
      `${this.baseUrl}/session/${encodeURIComponent(sessionId)}/prompt_async?${query}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          ...(request.reasoningEffort === "provider_default"
            ? {}
            : { variant: request.reasoningEffort }),
          parts: [
            {
              type: "text",
              text: request.text
            }
          ]
        })
      }
    );
    if (!response.ok) {
      throw new Error(`OpenCode prompt_async returned HTTP ${response.status}`);
    }
  }

  private reasoningEfforts(model: Provider["models"][string]): ProviderReasoningEffort[] {
    const efforts: ProviderReasoningEffort[] = ["provider_default"];
    const candidate = model as Provider["models"][string] & { variants?: unknown };
    if (!this.isRecord(candidate.variants)) return efforts;
    for (const effort of ["minimal", "low", "medium", "high", "xhigh"] as const) {
      if (effort in candidate.variants) efforts.push(effort);
    }
    return efforts;
  }

  private parseModelId(modelId: string): { providerID: string; modelID: string } {
    const separator = modelId.indexOf("/");
    if (separator <= 0 || separator === modelId.length - 1) {
      throw new Error(`OpenCode modelId ${modelId} is not namespaced`);
    }
    return {
      providerID: modelId.slice(0, separator),
      modelID: modelId.slice(separator + 1)
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private capabilities(
    version: string | null,
    digest: string | null,
    primitives: boolean,
    hasModels: boolean,
    failureReason?: string
  ): ProviderCapabilities {
    const available = version !== null;
    const compatible = available && primitives;
    const certified = version === certifiedServerVersion && digest === certifiedSchemaDigest;
    const ready = compatible && hasModels;
    const reason = !available
      ? failureReason ?? "opencode_server_unavailable"
      : !compatible
        ? "opencode_contract_missing_required_primitives"
        : !hasModels
          ? "opencode_model_catalog_empty"
          : null;
    const capability = (value: boolean, unavailableReason: string | null) => ({
      available: value,
      reason: value ? null : unavailableReason
    });
    return {
      schemaVersion: 1,
      providerId: this.providerId,
      version: `${adapterVersion}:${version ?? "unknown"}:${digest ?? "unknown"}`,
      availability: capability(available, reason),
      authentication: capability(hasModels, "opencode_model_catalog_empty"),
      models: capability(hasModels, "opencode_model_catalog_empty"),
      contract: {
        available: compatible,
        reason: !compatible
          ? "opencode_contract_missing_required_primitives"
          : certified
            ? null
            : "opencode_contract_not_certified",
        status: !compatible ? "incompatible" : certified ? "certified" : "compatible_unverified",
        expectedVersion: `${certifiedServerVersion}:${certifiedSchemaDigest}`,
        currentVersion: version && digest ? `${version}:${digest}` : version,
        action: !compatible
          ? "Export /doc and update OPENCODE_CONTRACT_UPGRADE.md before enabling runs"
          : certified
            ? null
            : "Run is allowed with a persistent warning; review OPENCODE_CONTRACT_UPGRADE.md"
      },
      start: capability(ready, reason),
      events: capability(ready, reason),
      cancel: capability(ready, reason),
      resume: capability(ready, reason),
      steer: {
        available: ready,
        reason,
        mode: ready ? "immediate" : "none"
      },
      usage: {
        available: false,
        reason: "opencode_usage_not_observed_by_probe",
        kind: "none"
      },
      attachments: capability(false, "opencode_attachments_not_certified_i8"),
      mcp: capability(false, "opencode_mcp_mapping_not_certified_i8"),
      permissionInterception: capability(ready, reason),
      optionsSchemaVersion: 1
    };
  }

  private safeReason(error: unknown): string {
    if (error instanceof TypeError) return "opencode_server_unavailable";
    return error instanceof Error
      ? `opencode_probe_failed:${error.message}`
      : "opencode_probe_failed";
  }

  private isContractError(error: unknown): boolean {
    return error instanceof Error && /contract|response|\/doc|providers/i.test(error.message);
  }
}
