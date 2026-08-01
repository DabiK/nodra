import type {
  ProviderSessionControlCapabilities,
  ProviderSessionControlPort,
  ProviderSessionStartTurnInput,
  ProviderSessionSteerInput,
  ProviderSessionSyncErrorCode,
  ProviderSessionTurnCommandResult
} from "@nodra/application";
import { ProviderSessionSyncError } from "@nodra/application";
import { CodexJsonRpcClient } from "./codex-json-rpc-client.js";
import { isRecord } from "./codex-json-rpc-types.js";
import { type CodexProcessLauncher, LocalCodexProcessLauncher } from "./codex-process-launcher.js";
import { CodexProtocolError } from "./codex-protocol-error.js";

const compatibleUnverified = {
  state: "compatible_unverified" as const,
  reason: "codex_attached_control_poc_required",
  action: "Run the Codex attached session control POC"
};

export class CodexProviderSessionControlAdapter implements ProviderSessionControlPort {
  readonly providerId = "codex";

  constructor(private readonly launcher: CodexProcessLauncher = new LocalCodexProcessLauncher()) {}

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
      const result = await this.withClient((client) => client.request("turn/start", {
        threadId: input.ref.externalSessionId,
        clientUserMessageId: input.clientCommandId,
        input: [{ type: "text", text: input.text }]
      }));
      if (!isRecord(result) || !isRecord(result.turn) || typeof result.turn.id !== "string" || !result.turn.id) {
        throw new CodexProtocolError("turn/start returned an invalid turn reference");
      }
      return { ref: input.ref, externalTurnId: result.turn.id };
    } catch (error) {
      throw this.mapError(error, input.ref.externalSessionId);
    }
  }

  async steer(input: ProviderSessionSteerInput): Promise<ProviderSessionTurnCommandResult> {
    this.assertRef(input.ref.providerId, input.ref.externalSessionId);
    try {
      const result = await this.withClient((client) => client.request("turn/steer", {
        threadId: input.ref.externalSessionId,
        expectedTurnId: input.externalTurnId,
        clientUserMessageId: input.clientCommandId,
        input: [{ type: "text", text: input.text }]
      }));
      if (!isRecord(result) || typeof result.turnId !== "string" || !result.turnId) {
        throw new CodexProtocolError("turn/steer returned an invalid turn reference");
      }
      if (result.turnId !== input.externalTurnId) {
        throw new CodexProtocolError("turn/steer returned a different turn reference");
      }
      return { ref: input.ref, externalTurnId: result.turnId };
    } catch (error) {
      throw this.mapError(error, input.ref.externalSessionId);
    }
  }

  private async withClient<T>(operation: (client: CodexJsonRpcClient) => Promise<T>): Promise<T> {
    const client = new CodexJsonRpcClient(this.launcher.launch());
    try {
      await client.initialize();
      return await operation(client);
    } finally {
      client.close();
    }
  }

  private assertRef(providerId: string, externalSessionId: string): void {
    if (providerId !== this.providerId) {
      throw this.failure("PROTOCOL_INCOMPATIBLE", externalSessionId, false, `Codex session control cannot use provider ${providerId}`);
    }
  }

  private mapError(error: unknown, externalSessionId: string): ProviderSessionSyncError {
    if (error instanceof ProviderSessionSyncError) return error;
    if (!(error instanceof CodexProtocolError)) return this.failure("UNKNOWN", externalSessionId, false, "Codex session control failed");
    const message = error.message.toLowerCase();
    if (/not found|unknown thread|does not exist/.test(message)) return this.failure("NOT_FOUND", externalSessionId, false, error.message);
    if (/permission|access denied|unauthorized|forbidden/.test(message)) return this.failure("ACCESS_DENIED", externalSessionId, false, error.message);
    if (error.code === "CODEX_BINARY_NOT_FOUND") return this.failure("UNAVAILABLE", externalSessionId, false, error.message);
    if (["CODEX_PROCESS_ERROR", "CODEX_PROCESS_EXIT", "CODEX_PROCESS_CLOSED"].includes(error.code)) {
      return this.failure("TRANSIENT_FAILURE", externalSessionId, true, error.message);
    }
    return this.failure("PROTOCOL_INCOMPATIBLE", externalSessionId, false, error.message);
  }

  private failure(code: ProviderSessionSyncErrorCode, externalSessionId: string, retryable: boolean, message: string): ProviderSessionSyncError {
    return new ProviderSessionSyncError({ code, providerId: this.providerId, externalSessionId, retryable, message });
  }
}
