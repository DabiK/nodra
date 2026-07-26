import type { ProviderEventInput } from "@nodra/application";
import { isRecord } from "./codex-json-rpc-types.js";
import { CodexRedactor } from "./codex-redactor.js";

export interface MappedCodexEvent {
  event: ProviderEventInput;
  terminalState: "SUCCEEDED" | "FAILED" | "CANCELLED" | null;
  incompatibleReason: string | null;
}

export class CodexEventMapper {
  constructor(private readonly redactor = new CodexRedactor()) {}

  map(method: string, params: unknown): MappedCodexEvent {
    let terminalState: MappedCodexEvent["terminalState"] = null;
    let incompatibleReason: string | null = null;
    if (method === "turn/completed" && isRecord(params) && isRecord(params.turn)) {
      const status = params.turn.status;
      terminalState = status === "completed"
        ? "SUCCEEDED"
        : status === "interrupted"
          ? "CANCELLED"
          : status === "failed"
            ? "FAILED"
            : null;
      if (!terminalState) incompatibleReason = "turn/completed has an unsupported terminal status";
    } else if (method === "turn/completed") {
      incompatibleReason = "turn/completed does not contain a turn object";
    }
    return {
      event: {
        type: method,
        payload: this.redactor.redact(params),
        occurredAt: new Date().toISOString()
      },
      terminalState,
      incompatibleReason
    };
  }
}
