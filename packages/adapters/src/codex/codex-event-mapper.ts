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
    const item = isRecord(params) && isRecord(params.item) ? params.item : null;
    const assistantMessageText = method === "item/completed"
      && item?.type === "agentMessage"
      && typeof item.text === "string"
      ? item.text
      : undefined;
    const assistantMessage = assistantMessageText === undefined
      ? undefined
      : this.redactor.redact(assistantMessageText) as string;
    const toolActivity = (method === "item/started" || method === "item/completed")
      && item !== null
      && typeof item.type === "string"
      && this.isToolItem(item.type);
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
        occurredAt: new Date().toISOString(),
        ...(assistantMessage === undefined ? {} : { assistantMessage }),
        ...(toolActivity ? { toolActivity: true } : {})
      },
      terminalState,
      incompatibleReason
    };
  }

  private isToolItem(type: string): boolean {
    return [
      "commandExecution",
      "fileChange",
      "mcpToolCall",
      "dynamicToolCall",
      "webSearch",
      "imageGeneration"
    ].includes(type);
  }
}
