import type {
  ProviderOneShotInput,
  ProviderOneShotPort,
  ProviderOneShotResult
} from "@nodra/application";
import { CodexJsonRpcClient } from "./codex-json-rpc-client.js";
import { isRecord } from "./codex-json-rpc-types.js";
import { type CodexProcessLauncher, LocalCodexProcessLauncher } from "./codex-process-launcher.js";
import { CodexProtocolError } from "./codex-protocol-error.js";

export class CodexProviderOneShotAdapter implements ProviderOneShotPort {
  readonly providerId = "codex";

  constructor(private readonly launcher: CodexProcessLauncher = new LocalCodexProcessLauncher()) {}

  async oneShot(input: ProviderOneShotInput): Promise<ProviderOneShotResult> {
    const client = new CodexJsonRpcClient(this.launcher.launch());
    try {
      await client.initialize();
      const started = await client.request("thread/start", {
        ...(input.modelId ? { model: input.modelId } : {}),
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: "read-only"
      });
      if (!isRecord(started) || !isRecord(started.thread) || typeof started.thread.id !== "string" || !started.thread.id) {
        throw new CodexProtocolError("thread/start returned an invalid thread reference");
      }
      const threadId = started.thread.id;
      const completed = this.waitForTurnCompletion(client);
      const turnStarted = await client.request("turn/start", {
        threadId,
        clientUserMessageId: `one-shot/${crypto.randomUUID()}`,
        input: [{ type: "text", text: input.prompt }],
        ...(input.modelId ? { model: input.modelId } : {}),
        ...(input.reasoningEffort && input.reasoningEffort !== "provider_default"
          ? { effort: input.reasoningEffort }
          : {})
      });
      if (!isRecord(turnStarted) || !isRecord(turnStarted.turn) || typeof turnStarted.turn.id !== "string" || !turnStarted.turn.id) {
        throw new CodexProtocolError("turn/start returned an invalid turn reference");
      }
      const { turnId, status } = await completed;
      if (turnId !== turnStarted.turn.id) {
        throw new CodexProtocolError("turn/completed reported a different turn reference");
      }
      if (status === "failed") {
        throw new CodexProtocolError("Codex one-shot turn failed");
      }
      const text = await this.lastAgentMessage(client, threadId);
      if (!text) throw new CodexProtocolError("Codex one-shot returned an empty reply");
      return { text };
    } catch (error) {
      throw this.mapError(error);
    } finally {
      client.close();
    }
  }

  private waitForTurnCompletion(client: CodexJsonRpcClient): Promise<{ turnId: string; status: string }> {
    return new Promise<{ turnId: string; status: string }>((resolve, reject) => {
      client.onNotification(async (method, params) => {
        if (method !== "turn/completed") return;
        const turn = isRecord(params) && isRecord(params.turn) ? params.turn : null;
        if (!turn || typeof turn.id !== "string" || !turn.id) {
          reject(new CodexProtocolError("turn/completed returned an invalid turn reference"));
          return;
        }
        resolve({ turnId: turn.id, status: typeof turn.status === "string" ? turn.status : "unknown" });
      });
      client.onFailure(reject);
    });
  }

  private async lastAgentMessage(client: CodexJsonRpcClient, threadId: string): Promise<string | null> {
    const result = await client.request("thread/read", { threadId, includeTurns: true });
    if (!isRecord(result) || !isRecord(result.thread)) {
      throw new CodexProtocolError("thread/read returned an invalid thread shape");
    }
    const turns = Array.isArray(result.thread.turns) ? result.thread.turns : [];
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = isRecord(turns[i]) ? turns[i] : null;
      if (!turn) continue;
      const items = Array.isArray(turn.items) ? turn.items : [];
      for (let j = items.length - 1; j >= 0; j--) {
        const item = isRecord(items[j]) ? items[j] : null;
        if (!item || item.type !== "agentMessage") continue;
        if (typeof item.text === "string" && item.text.trim().length > 0) return item.text;
      }
    }
    return null;
  }

  private mapError(error: unknown): Error {
    if (error instanceof CodexProtocolError) {
      if (error.code === "CODEX_BINARY_NOT_FOUND") {
        return new Error("Le binaire codex est introuvable : installe Codex puis réessaie.");
      }
      return new Error(error.message);
    }
    if (error instanceof Error) return error;
    return new Error("Codex one-shot failed");
  }
}
