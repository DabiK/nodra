import {
  deriveProviderHealth,
  ProviderProtocolIncompatibleError,
  type ProviderCapabilities,
  type ProviderExecutionResult,
  type ProviderExecutionSink,
  type ProviderModel,
  type ProviderPermissionDecision,
  type ProviderPermissionRequest,
  type ProviderPort,
  type ProviderProbeResult,
  type ProviderReasoningEffort,
  type ProviderRunConfiguration
} from "@nodra/application";
import { CodexEventMapper } from "./codex-event-mapper.js";
import { CodexJsonRpcClient } from "./codex-json-rpc-client.js";
import { isRecord, type JsonRpcRequest } from "./codex-json-rpc-types.js";
import {
  LocalCodexProcessLauncher,
  type CodexProcessLauncher
} from "./codex-process-launcher.js";
import { CodexProcessSupervisor } from "./codex-process-supervisor.js";
import { CodexProtocolError } from "./codex-protocol-error.js";
import { CodexRedactor } from "./codex-redactor.js";

const adapterVersion = "codex-app-server-stdio-v1";
const certifiedBinaryVersion = "codex_cli_rs/0.145.0";

export class CodexProviderAdapter implements ProviderPort {
  readonly providerId = "codex";

  constructor(
    private readonly launcher: CodexProcessLauncher = new LocalCodexProcessLauncher(),
    private readonly supervisor = new CodexProcessSupervisor(),
    private readonly mapper = new CodexEventMapper(),
    private readonly redactor = new CodexRedactor()
  ) {}

  async probe(): Promise<ProviderProbeResult> {
    const probedAt = new Date().toISOString();
    let client: CodexJsonRpcClient | null = null;
    let binaryVersion: string | null = null;
    try {
      client = new CodexJsonRpcClient(this.launcher.launch());
      const initialized = await client.initialize();
      binaryVersion = typeof initialized.userAgent === "string" ? initialized.userAgent : null;
      if (!binaryVersion) {
        throw new CodexProtocolError("initialize did not report userAgent");
      }
      const account = await client.request("account/read", { refreshToken: false });
      if (
        !isRecord(account)
        || !("account" in account)
        || typeof account.requiresOpenaiAuth !== "boolean"
      ) {
        throw new CodexProtocolError("account/read returned an invalid result");
      }
      const modelResult = await client.request("model/list", {});
      const models = this.models(modelResult);
      const authenticated = account.account !== null && account.account !== undefined;
      const authKind = authenticated && isRecord(account.account) && typeof account.account.type === "string"
        ? account.account.type
        : null;
      const capabilities = this.capabilities(
        authenticated,
        models.length > 0,
        binaryVersion,
        false
      );
      return {
        providerId: this.providerId,
        adapterVersion,
        binaryVersion,
        authenticated,
        authKind,
        health: deriveProviderHealth(capabilities),
        capabilities,
        models,
        probedAt
      };
    } catch (error) {
      const capabilities = this.capabilities(
        false,
        false,
        binaryVersion,
        this.isProtocolFailure(error),
        this.safeReason(error)
      );
      return {
        providerId: this.providerId,
        adapterVersion,
        binaryVersion,
        authenticated: false,
        authKind: null,
        health: deriveProviderHealth(capabilities),
        capabilities,
        models: [],
        probedAt
      };
    } finally {
      client?.close();
    }
  }

  async execute(
    input: ProviderRunConfiguration,
    sink: ProviderExecutionSink
  ): Promise<ProviderExecutionResult> {
    const client = new CodexJsonRpcClient(this.launcher.launch());
    const active = this.supervisor.attach(input.runId, client);
    let terminalResolve!: (state: ProviderExecutionResult["state"]) => void;
    let terminalReject!: (error: Error) => void;
    const terminal = new Promise<ProviderExecutionResult["state"]>((resolve, reject) => {
      terminalResolve = resolve;
      terminalReject = reject;
    });
    client.onNotification(async (method, params) => {
      const mapped = this.mapper.map(method, params);
      await sink.event(mapped.event);
      if (mapped.incompatibleReason) {
        throw new ProviderProtocolIncompatibleError(
          mapped.incompatibleReason,
          this.providerId,
          active.binaryVersion
        );
      }
      if (mapped.terminalState) terminalResolve(mapped.terminalState);
    });
    client.onFailure(terminalReject);
    client.onServerRequest(async (request) => {
      try {
        const permission = this.permissionRequest(request);
        return this.permissionResponse(permission, await sink.permission(permission));
      } catch (error) {
        const incompatible = this.incompatibleError(error, active.binaryVersion);
        if (incompatible) {
          terminalReject(incompatible);
          throw incompatible;
        }
        throw error;
      }
    });

    try {
      const initialized = await client.initialize();
      if (typeof initialized.userAgent !== "string") {
        throw new CodexProtocolError("initialize did not report userAgent");
      }
      active.binaryVersion = initialized.userAgent;
      if (
        input.contractStatus === "compatible_unverified"
        || !input.capabilityVersion.endsWith(`:${initialized.userAgent}`)
      ) {
        await sink.event({
          type: "provider/contractWarning",
          payload: {
            code: "compatible_unverified",
            capabilityVersion: input.capabilityVersion,
            currentVersion: initialized.userAgent
          },
          occurredAt: new Date().toISOString()
        });
      }
      const threadResult = await client.request(input.session ? "thread/resume" : "thread/start", {
        ...(input.session ? { threadId: input.session.externalId } : {}),
        model: input.modelId,
        cwd: input.cwd,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: this.sandbox(input.permissionPreset)
      });
      const threadId = this.nestedId(threadResult, "thread");
      active.threadId = threadId;
      await sink.session(threadId);
      const turnResult = await client.request("turn/start", {
        threadId,
        clientUserMessageId: `${input.runId}/prompt`,
        input: [{ type: "text", text: input.prompt }],
        model: input.modelId,
        cwd: input.cwd,
        ...(input.reasoningEffort === "provider_default" ? {} : { effort: input.reasoningEffort })
      });
      const turnId = this.nestedId(turnResult, "turn");
      active.turnId = turnId;
      await sink.runRef(turnId);
      const state = await terminal.catch((error: unknown) => {
        throw error instanceof Error ? error : new CodexProtocolError("Codex turn failed");
      });
      return { state, externalSessionId: threadId, externalRunId: turnId };
    } catch (error) {
      const incompatible = this.incompatibleError(error, active.binaryVersion);
      const failure = incompatible
        ?? (error instanceof Error ? error : new CodexProtocolError("Codex execution failed"));
      if (incompatible) await this.persistIncompatibleEvent(sink, incompatible);
      terminalReject(failure);
      await terminal.catch(() => undefined);
      throw failure;
    } finally {
      this.supervisor.release(input.runId);
    }
  }

  async cancel(runId: string): Promise<void> {
    const active = this.supervisor.get(runId);
    if (!active?.threadId || !active.turnId) {
      throw new CodexProtocolError("No active Codex turn is available", "CODEX_TURN_NOT_ACTIVE");
    }
    try {
      const result = await active.client.request("turn/interrupt", {
        threadId: active.threadId,
        turnId: active.turnId
      });
      if (!isRecord(result)) {
        throw new CodexProtocolError("turn/interrupt returned an invalid result");
      }
    } catch (error) {
      throw this.incompatibleError(error, active.binaryVersion) ?? error;
    }
  }

  async steer(runId: string, text: string): Promise<void> {
    const active = this.supervisor.get(runId);
    if (!active?.threadId || !active.turnId) {
      throw new CodexProtocolError("No active Codex turn is available", "CODEX_TURN_NOT_ACTIVE");
    }
    try {
      const result = await active.client.request("turn/steer", {
        threadId: active.threadId,
        expectedTurnId: active.turnId,
        clientUserMessageId: `${runId}/steer/${Date.now()}`,
        input: [{ type: "text", text }]
      });
      if (!isRecord(result) || typeof result.turnId !== "string") {
        throw new CodexProtocolError("turn/steer returned an invalid result");
      }
    } catch (error) {
      throw this.incompatibleError(error, active.binaryVersion) ?? error;
    }
  }

  private permissionRequest(request: JsonRpcRequest): ProviderPermissionRequest {
    const approvalMethods = [
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
      "item/permissions/requestApproval"
    ];
    if (!approvalMethods.includes(request.method)) {
      throw new CodexProtocolError(
        `Unsupported server request ${request.method}`,
        "CODEX_REQUEST_UNSUPPORTED"
      );
    }
    if (!isRecord(request.params)) {
      throw new CodexProtocolError(`Approval request ${request.method} has invalid params`);
    }
    const cwd = typeof request.params.cwd === "string" ? request.params.cwd : null;
    return {
      requestId: request.id,
      action: request.method,
      target: this.redactor.redact({
        method: request.method,
        params: request.params
      }) as Record<string, unknown>,
      cwd,
      risk: request.method === "item/commandExecution/requestApproval"
        ? "provider_command_execution"
        : request.method === "item/fileChange/requestApproval"
          ? "provider_file_change"
          : "provider_permission_expansion",
      providerRequest: request
    };
  }

  private permissionResponse(
    request: ProviderPermissionRequest,
    decision: ProviderPermissionDecision
  ): unknown {
    if (request.action === "item/permissions/requestApproval") {
      return {
        scope: "turn",
        permissions: decision === "approved"
          ? this.requestedPermissions(request.providerRequest)
          : {}
      };
    }
    return { decision: decision === "approved" ? "accept" : "decline" };
  }

  private requestedPermissions(providerRequest: unknown): Record<string, unknown> {
    if (!isRecord(providerRequest) || !isRecord(providerRequest.params)) return {};
    return isRecord(providerRequest.params.permissions)
      ? providerRequest.params.permissions
      : {};
  }

  private models(result: unknown): ProviderModel[] {
    if (!isRecord(result) || !Array.isArray(result.data)) {
      throw new CodexProtocolError("model/list returned an invalid result");
    }
    return result.data.flatMap((value): ProviderModel[] => {
      if (!isRecord(value) || typeof value.model !== "string") return [];
      const efforts = Array.isArray(value.supportedReasoningEfforts)
        ? value.supportedReasoningEfforts.flatMap((option): ProviderReasoningEffort[] => {
          if (!isRecord(option) || typeof option.reasoningEffort !== "string") return [];
          return this.effort(option.reasoningEffort) ? [option.reasoningEffort as ProviderReasoningEffort] : [];
        })
        : [];
      const defaultEffort = typeof value.defaultReasoningEffort === "string" && this.effort(value.defaultReasoningEffort)
        ? value.defaultReasoningEffort as ProviderReasoningEffort
        : "provider_default";
      return [{
        id: value.model,
        displayName: typeof value.displayName === "string" ? value.displayName : value.model,
        description: typeof value.description === "string" ? value.description : "",
        hidden: value.hidden === true,
        isDefault: value.isDefault === true,
        supportedReasoningEfforts: efforts,
        defaultReasoningEffort: defaultEffort
      }];
    });
  }

  private capabilities(
    authenticated: boolean,
    hasModels: boolean,
    binaryVersion: string | null,
    incompatible: boolean,
    processReason?: string
  ): ProviderCapabilities {
    const processAvailable = binaryVersion !== null;
    const certifiedVersion = binaryVersion === certifiedBinaryVersion;
    const contractAvailable = processAvailable && !incompatible;
    const ready = contractAvailable && authenticated && hasModels;
    const startReason = !processAvailable
      ? processReason ?? "codex_app_server_unavailable"
      : incompatible
        ? "protocol_incompatible"
        : processReason
          ?? (!authenticated ? "codex_authentication_required"
          : !hasModels ? "codex_model_catalog_empty"
            : null);
    const capability = (available: boolean, unavailableReason: string | null) => ({
      available,
      reason: available ? null : unavailableReason
    });
    return {
      schemaVersion: 1,
      providerId: this.providerId,
      version: `${adapterVersion}:${binaryVersion ?? "unknown"}`,
      availability: capability(
        processAvailable,
        processReason ?? "codex_app_server_unavailable"
      ),
      authentication: capability(authenticated, "codex_authentication_required"),
      models: capability(hasModels, "codex_model_catalog_empty"),
      contract: {
        available: contractAvailable,
        reason: !contractAvailable
          ? "protocol_incompatible"
          : certifiedVersion
            ? null
            : "codex_binary_version_not_certified",
        status: !contractAvailable
          ? "incompatible"
          : certifiedVersion
            ? "certified"
            : "compatible_unverified",
        expectedVersion: certifiedBinaryVersion,
        currentVersion: binaryVersion,
        action: !contractAvailable
          ? "Resolve the failed consumer invariant and follow CONTRACT_UPGRADE.md"
          : certifiedVersion
            ? null
            : "Run is allowed with a persistent warning; review CONTRACT_UPGRADE.md"
      },
      start: capability(ready, startReason),
      events: capability(ready, startReason),
      cancel: capability(ready, startReason),
      resume: capability(ready, startReason),
      steer: { ...capability(ready, startReason), mode: ready ? "immediate" : "none" },
      usage: {
        available: false,
        reason: "usage_not_observed_by_explicit_probe",
        kind: "none"
      },
      attachments: capability(false, "nodra_attachment_mapping_not_certified_i6"),
      mcp: capability(false, "nodra_mcp_binding_not_certified_i6"),
      permissionInterception: capability(ready, startReason),
      optionsSchemaVersion: 1
    };
  }

  private nestedId(value: unknown, key: string): string {
    if (!isRecord(value) || !isRecord(value[key]) || typeof value[key].id !== "string") {
      throw new CodexProtocolError(`${key} response did not contain an id`);
    }
    return value[key].id;
  }

  private sandbox(preset: ProviderRunConfiguration["permissionPreset"]) {
    return preset === "read_only"
      ? "read-only"
      : preset === "workspace"
        ? "workspace-write"
        : "danger-full-access";
  }

  private effort(value: string): boolean {
    return ["minimal", "low", "medium", "high", "xhigh"].includes(value);
  }

  private safeReason(error: unknown): string {
    if (error instanceof CodexProtocolError) {
      if (error.code === "CODEX_BINARY_NOT_FOUND") return "codex_binary_not_found";
      if (["CODEX_PROCESS_ERROR", "CODEX_PROCESS_EXIT"].includes(error.code)) {
        return "codex_app_server_unavailable";
      }
      return error.code;
    }
    return "codex_app_server_unavailable";
  }

  private isProtocolFailure(error: unknown): boolean {
    if (!(error instanceof CodexProtocolError)) return false;
    if (error.code === "CODEX_REMOTE_ERROR") {
      return error.remoteCode !== null
        && [-32600, -32601, -32602].includes(error.remoteCode);
    }
    return ![
        "CODEX_BINARY_NOT_FOUND",
        "CODEX_PROCESS_ERROR",
        "CODEX_PROCESS_EXIT",
        "CODEX_PROCESS_CLOSED",
        "CODEX_REQUEST_UNSUPPORTED"
    ].includes(error.code);
  }

  private incompatibleError(
    error: unknown,
    currentVersion: string | null
  ): ProviderProtocolIncompatibleError | null {
    if (error instanceof ProviderProtocolIncompatibleError) return error;
    if (!this.isProtocolFailure(error)) return null;
    return new ProviderProtocolIncompatibleError(
      error instanceof Error ? error.message : "Codex consumer contract failed",
      this.providerId,
      currentVersion
    );
  }

  private async persistIncompatibleEvent(
    sink: ProviderExecutionSink,
    error: ProviderProtocolIncompatibleError
  ): Promise<void> {
    await sink.event({
      type: "provider/protocolIncompatible",
      payload: {
        code: "protocol_incompatible",
        reason: this.redactor.redact(error.message),
        currentVersion: error.currentVersion
      },
      occurredAt: new Date().toISOString()
    });
  }
}
