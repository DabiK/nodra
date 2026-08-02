import { createOpencodeClient, type AssistantMessage, type SessionPromptAsyncData } from "@opencode-ai/sdk";
import type {
  ProviderSessionControlCapabilities,
  ProviderSessionControlPort,
  ProviderSessionStartTurnInput,
  ProviderSessionSteerInput,
  ProviderSessionSyncErrorCode,
  ProviderSessionTurnCommandResult
} from "@nodra/application";
import { ProviderSessionSyncError } from "@nodra/application";

type OpenCodeSessionClient = ReturnType<typeof createOpencodeClient>;

const compatibleUnverified = {
  state: "compatible_unverified" as const,
  reason: "opencode_session_control_required",
  action: "Run the OpenCode attached session control POC"
};

export interface OpenCodeProviderSessionControlAdapterOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  executionTimeoutMs?: number;
  pollIntervalMs?: number;
  createClient?: (baseUrl: string, fetchImpl: typeof fetch) => OpenCodeSessionClient;
}

export class OpenCodeProviderSessionControlAdapter implements ProviderSessionControlPort {
  readonly providerId = "opencode";
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly executionTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly createClientImpl: (baseUrl: string, fetchImpl: typeof fetch) => OpenCodeSessionClient;

  constructor(options: OpenCodeProviderSessionControlAdapterOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:4096").replace(/\/+$/, "");
    this.fetchImplementation = options.fetch ?? fetch;
    this.executionTimeoutMs = options.executionTimeoutMs ?? 300_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 750;
    this.createClientImpl = options.createClient
      ?? ((baseUrl, fetchImpl) => createOpencodeClient({ baseUrl, fetch: fetchImpl }));
  }

  async capabilities(): Promise<ProviderSessionControlCapabilities> {
    return {
      schemaVersion: 1,
      providerId: this.providerId,
      read: compatibleUnverified,
      startTurn: compatibleUnverified,
      steer: compatibleUnverified,
      queue: { state: "unavailable", reason: "provider_session_local_queue_forbidden", action: null }
    };
  }

  async startTurn(input: ProviderSessionStartTurnInput): Promise<ProviderSessionTurnCommandResult> {
    this.assertRef(input.ref.providerId, input.ref.externalSessionId);
    try {
      const externalTurnId = await this.command(input.ref.externalSessionId, input.text, input);
      return { ref: input.ref, externalTurnId };
    } catch (error) {
      throw this.mapError(error, input.ref.externalSessionId);
    }
  }

  async steer(input: ProviderSessionSteerInput): Promise<ProviderSessionTurnCommandResult> {
    this.assertRef(input.ref.providerId, input.ref.externalSessionId);
    try {
      const externalTurnId = await this.command(input.ref.externalSessionId, input.text, input);
      return { ref: input.ref, externalTurnId };
    } catch (error) {
      throw this.mapError(error, input.ref.externalSessionId);
    }
  }

  private async command(sessionId: string, text: string, run: { modelId?: string; reasoningEffort?: string } = {}): Promise<string> {
    const client = this.client();
    const before = await client.session.messages({ path: { id: sessionId }, throwOnError: true });
    const knownUserIds = new Set(before.data.map((message) => message.info.id));
    const deadline = Date.now() + this.executionTimeoutMs;

    await client.session.promptAsync({
      path: { id: sessionId },
      body: this.promptBody(text, run),
      throwOnError: true
    });

    while (Date.now() < deadline) {
      await this.delay(Math.min(this.pollIntervalMs, Math.max(0, deadline - Date.now())));
      if (Date.now() >= deadline) break;
      const messages = await client.session.messages({ path: { id: sessionId }, throwOnError: true });
      const user = messages.data.find((message) => message.info.role === "user" && !knownUserIds.has(message.info.id));
      if (!user) continue;
      const reply = messages.data.find(
        (message) =>
          message.info.role === "assistant"
          && message.info.parentID === user.info.id
          && message.info.time?.completed !== undefined
      );
      if (!reply) continue;
      if (await this.isSessionBusy(client, sessionId)) continue;
      if ("error" in reply.info && reply.info.error) throw this.commandError(reply.info.error, sessionId);
      return user.info.id;
    }
    throw this.failure(
      "UNAVAILABLE",
      sessionId,
      false,
      `OpenCode session prompt timed out after ${this.executionTimeoutMs}ms`
    );
  }

  // OpenCode Serve accepts an optional per-prompt model override and a
  // reasoning "variant" next to the text parts. The SDK body type does not
  // expose these fields yet, so they are added with an explicit cast.
  private promptBody(
    text: string,
    run: { modelId?: string; reasoningEffort?: string }
  ): NonNullable<SessionPromptAsyncData["body"]> & { model?: unknown; variant?: string } {
    return {
      parts: [{ type: "text", text }],
      ...(run.modelId ? { model: this.parseModelId(run.modelId) } : {}),
      ...(run.reasoningEffort && run.reasoningEffort !== "provider_default"
        ? { variant: run.reasoningEffort }
        : {})
    } as NonNullable<SessionPromptAsyncData["body"]> & { model?: unknown; variant?: string };
  }

  private parseModelId(modelId: string): { providerID: string; modelID: string } {
    const separator = modelId.indexOf("/");
    if (separator <= 0 || separator === modelId.length - 1) {
      throw this.failure("PROTOCOL_INCOMPATIBLE", "", false, `OpenCode modelId ${modelId} is not namespaced`);
    }
    return {
      providerID: modelId.slice(0, separator),
      modelID: modelId.slice(separator + 1)
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref();
    });
  }

  // A completed assistant step does not mean the turn is done: OpenCode Serve
  // streams several steps (reasoning, tools, text) for a single prompt and only
  // releases the session busy state when the whole turn finished. Poll the
  // /session/status map so a mid-turn step completion cannot end the command
  // early and race the mission auto-validation.
  private async isSessionBusy(client: OpenCodeSessionClient, sessionId: string): Promise<boolean> {
    try {
      const statuses = await client.session.status({ throwOnError: true });
      const status = statuses.data[sessionId];
      return status !== undefined && status.type !== "idle";
    } catch {
      return false;
    }
  }

  private client(): OpenCodeSessionClient {
    return this.createClientImpl(this.baseUrl, this.fetchImplementation);
  }

  private assertRef(providerId: string, externalSessionId: string): void {
    if (providerId !== this.providerId) {
      throw this.failure(
        "PROTOCOL_INCOMPATIBLE",
        externalSessionId,
        false,
        `OpenCode session control cannot use provider ${providerId}`
      );
    }
  }

  private commandError(error: Exclude<AssistantMessage["error"], undefined>, sessionId: string): ProviderSessionSyncError {
    const data = error.data as { message?: unknown } | undefined;
    const message = typeof data?.message === "string" && data.message.length > 0
      ? data.message
      : error.name;
    return this.failure("UNKNOWN", sessionId, false, message);
  }

  private mapError(error: unknown, externalSessionId: string): ProviderSessionSyncError {
    if (error instanceof ProviderSessionSyncError) return error;
    const message = error instanceof Error ? error.message : String(error);
    if (this.statusCode(error) === 404 || /not found|no session|does not exist/i.test(message)) {
      return this.failure("NOT_FOUND", externalSessionId, false, message);
    }
    if (this.statusCode(error) === 400) {
      return this.failure("TRANSIENT_FAILURE", externalSessionId, true, message);
    }
    if (error instanceof TypeError) {
      return this.failure("UNAVAILABLE", externalSessionId, true, message);
    }
    return this.failure("UNKNOWN", externalSessionId, false, message);
  }

  private statusCode(error: unknown): number | null {
    const record = error as { statusCode?: unknown; status?: unknown; cause?: unknown };
    for (const candidate of [record.statusCode, record.status]) {
      if (typeof candidate === "number") return candidate;
    }
    if (isRecord(record.cause)) {
      for (const candidate of [record.cause.status, record.cause.statusCode]) {
        if (typeof candidate === "number") return candidate;
      }
    }
    return null;
  }

  private failure(
    code: ProviderSessionSyncErrorCode,
    externalSessionId: string,
    retryable: boolean,
    message: string
  ): ProviderSessionSyncError {
    return new ProviderSessionSyncError({ code, providerId: this.providerId, externalSessionId, retryable, message });
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
