import {
  createOpencodeClient,
  type Part,
  type Session,
  type SessionPromptAsyncData
} from "@opencode-ai/sdk";
import type {
  ProviderOneShotInput,
  ProviderOneShotPort,
  ProviderOneShotResult
} from "@nodra/application";

type OpenCodeClient = ReturnType<typeof createOpencodeClient>;

export interface OpenCodeProviderOneShotAdapterOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  executionTimeoutMs?: number;
  pollIntervalMs?: number;
  createClient?: (baseUrl: string, fetchImpl: typeof fetch) => OpenCodeClient;
}

export class OpenCodeProviderOneShotAdapter implements ProviderOneShotPort {
  readonly providerId = "opencode";
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly executionTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly createClientImplementation: (baseUrl: string, fetchImpl: typeof fetch) => OpenCodeClient;

  constructor(options: OpenCodeProviderOneShotAdapterOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:4096").replace(/\/+$/, "");
    this.fetchImplementation = options.fetch ?? fetch;
    this.executionTimeoutMs = options.executionTimeoutMs ?? 300_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 750;
    this.createClientImplementation = options.createClient
      ?? ((baseUrl, fetchImpl) => createOpencodeClient({ baseUrl, fetch: fetchImpl }));
  }

  async oneShot(input: ProviderOneShotInput): Promise<ProviderOneShotResult> {
    const client = this.createClientImplementation(this.baseUrl, this.fetchImplementation);
    let sessionId: string | null = null;
    try {
      const created = await client.session.create({ throwOnError: true });
      const session: Session = created.data;
      sessionId = session.id;
      const directory = this.optionalString(session.directory);
      const query = directory ? { directory } : undefined;

      const promptBody = {
        parts: [{ type: "text", text: input.prompt }],
        ...(input.modelId ? { model: this.parseModelId(input.modelId) } : {}),
        ...(input.reasoningEffort && input.reasoningEffort !== "provider_default"
          ? { variant: input.reasoningEffort }
          : {})
      } as SessionPromptAsyncData["body"] & { model?: unknown; variant?: string };

      const beforeMessages = await client.session.messages({
        path: { id: sessionId },
        ...(query ? { query } : {}),
        throwOnError: true
      });
      const before = new Set(beforeMessages.data.map((message) => message.info.id));

      await client.session.promptAsync({
        path: { id: sessionId },
        ...(query ? { query } : {}),
        body: promptBody,
        throwOnError: true
      });

      const text = await this.waitForReply(client, sessionId, query, before);
      const trimmed = text.trim();
      if (!trimmed) throw new Error("OpenCode one-shot returned an empty reply");
      return { text: trimmed };
    } catch (error) {
      throw this.mapError(error);
    } finally {
      if (sessionId !== null) {
        await client.session.delete({ path: { id: sessionId } }).catch(() => undefined);
      }
    }
  }

  private async waitForReply(
    client: OpenCodeClient,
    sessionId: string,
    query: { directory: string } | undefined,
    before: Set<string>
  ): Promise<string> {
    const deadline = Date.now() + this.executionTimeoutMs;
    while (Date.now() < deadline) {
      await this.delay(Math.min(this.pollIntervalMs, Math.max(0, deadline - Date.now())));
      if (Date.now() >= deadline) break;
      const current = await client.session.messages({
        path: { id: sessionId },
        ...(query ? { query } : {}),
        throwOnError: true
      });
      const user = current.data.find(
        (message) => message.info.role === "user" && !before.has(message.info.id)
      );
      if (!user) continue;
      const replies = current.data.filter(
        (message) =>
          message.info.role === "assistant"
          && message.info.parentID === user.info.id
          && message.info.time?.completed !== undefined
      );
      if (replies.length === 0) continue;
      const text = this.messageText(replies.flatMap((reply) => reply.parts));
      if (text.trim().length > 0) return text;
    }
    throw new Error(`OpenCode one-shot timed out after ${this.executionTimeoutMs}ms`);
  }

  private messageText(parts: Part[]): string {
    return parts
      .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("");
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

  private mapError(error: unknown): Error {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (/timed out|ECONNREFUSED|failed to fetch|unreachable/i.test(message)) {
        return new Error("OpenCode serve est injoignable : démarre `opencode serve` puis réessaie.");
      }
      return error;
    }
    return new Error("OpenCode one-shot failed");
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref();
    });
  }

  private optionalString(value: string): string | null {
    return value.length > 0 ? value : null;
  }
}
