import type {
  ProviderHistoryPage,
  ProviderHistoryQuery,
  ProviderSessionEvent,
  ProviderSessionItem,
  ProviderSessionItemKind,
  ProviderSessionItemRole,
  ProviderSessionListQuery,
  ProviderSessionPage,
  ProviderSessionRef,
  ProviderSessionSnapshot,
  ProviderSessionState,
  ProviderSessionSummary,
  ProviderSessionSyncCapabilities,
  ProviderSessionSyncErrorCode,
  ProviderSessionSyncPort,
  ProviderSessionTurn,
  ProviderSessionTurnState,
  ProviderSubscription
} from "@nodra/application";
import { ProviderSessionSyncError } from "@nodra/application";
import { CodexJsonRpcClient } from "./codex-json-rpc-client.js";
import { isRecord } from "./codex-json-rpc-types.js";
import {
  type CodexProcessLauncher,
  LocalCodexProcessLauncher
} from "./codex-process-launcher.js";
import { CodexProtocolError } from "./codex-protocol-error.js";
import { CodexRedactor } from "./codex-redactor.js";

type Clock = () => string;

interface MappedItem {
  role: ProviderSessionItemRole;
  kind: ProviderSessionItemKind;
  text: string | null;
  name: string | null;
}

const unavailable = (reason: string) => ({
  state: "unavailable" as const,
  reason,
  action: null
});

export class CodexProviderSessionSyncAdapter implements ProviderSessionSyncPort {
  readonly providerId = "codex";
  private readonly redactor = new CodexRedactor();

  constructor(
    private readonly launcher: CodexProcessLauncher = new LocalCodexProcessLauncher(),
    private readonly now: Clock = () => new Date().toISOString()
  ) {}

  async capabilities(): Promise<ProviderSessionSyncCapabilities> {
    const compatibleUnverified = {
      state: "compatible_unverified" as const,
      reason: "codex_session_sync_poc_required",
      action: "Run the Codex session synchronization POC"
    };
    return {
      schemaVersion: 1,
      providerId: "codex",
      listSessions: compatibleUnverified,
      readSession: compatibleUnverified,
      readHistory: unavailable("codex_history_pagination_unavailable"),
      subscribe: unavailable("codex_external_subscription_unavailable"),
      cursorResume: unavailable("codex_cursor_resume_unavailable"),
      attachedControl: unavailable("codex_attached_control_unavailable")
    };
  }

  async listSessions(query: ProviderSessionListQuery): Promise<ProviderSessionPage> {
    this.assertProvider(query.providerId, null);
    try {
      return await this.withClient(async (client) => {
        const result = await client.request("thread/list", {
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.limit === undefined ? {} : { limit: query.limit })
        });
        const page = this.listResponse(result);
        const receivedAt = this.now();
        return {
          sessions: page.data.map((thread) => this.summary(thread, receivedAt)),
          nextCursor: page.nextCursor
        };
      });
    } catch (error) {
      throw this.syncError(error, null);
    }
  }

  async readSession(ref: ProviderSessionRef): Promise<ProviderSessionSnapshot> {
    this.assertProvider(ref.providerId, ref.externalSessionId);
    try {
      return await this.withClient(async (client) => {
        const result = await client.request("thread/read", {
          threadId: ref.externalSessionId,
          includeTurns: true
        });
        const thread = this.readResponse(result);
        if (thread.id !== ref.externalSessionId) {
          throw new CodexProtocolError("thread/read returned a different thread id");
        }
        const receivedAt = this.now();
        const turns = thread.turns.map((turn, order) => this.turn(turn, order, receivedAt));
        let itemOrder = 0;
        const items = thread.turns.flatMap((turn) => {
          const externalTurnId = this.stringField(turn, "id", "turn id");
          const values = this.arrayField(turn, "items", "turn items");
          const toolNames = this.callToolNames(values);
          return values.map((item) => this.item(item, externalTurnId, itemOrder++, receivedAt, toolNames));
        });
        return {
          session: this.summary(thread, receivedAt),
          turns,
          items,
          cursor: null
        };
      });
    } catch (error) {
      throw this.syncError(error, ref.externalSessionId);
    }
  }

  async readHistory(query: ProviderHistoryQuery): Promise<ProviderHistoryPage> {
    this.assertProvider(query.ref.providerId, query.ref.externalSessionId);
    throw this.failure(
      "UNAVAILABLE",
      query.ref.externalSessionId,
      false,
      "Codex history pagination is unavailable; use readSession for a full snapshot"
    );
  }

  subscribe(input: ProviderSubscription): AsyncIterable<ProviderSessionEvent> {
    this.assertProvider(input.ref.providerId, input.ref.externalSessionId);
    const error = this.failure(
      "UNAVAILABLE",
      input.ref.externalSessionId,
      false,
      "Codex external session subscription is unavailable"
    );
    const iterator: AsyncIterableIterator<ProviderSessionEvent> = {
      next: async () => { throw error; },
      [Symbol.asyncIterator]() { return this; }
    };
    return iterator;
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

  private listResponse(value: unknown): { data: Record<string, unknown>[]; nextCursor: string | null } {
    if (!isRecord(value) || !Array.isArray(value.data)
      || !("nextCursor" in value)
      || (value.nextCursor !== null && typeof value.nextCursor !== "string")) {
      throw new CodexProtocolError("thread/list returned an invalid data or nextCursor shape");
    }
    const data = value.data.map((thread) => this.record(thread, "thread/list data item"));
    return { data, nextCursor: value.nextCursor };
  }

  private readResponse(value: unknown): Record<string, unknown> & { id: string; turns: Record<string, unknown>[] } {
    if (!isRecord(value) || !isRecord(value.thread)) {
      throw new CodexProtocolError("thread/read returned an invalid thread shape");
    }
    const id = this.stringField(value.thread, "id", "thread id");
    const turns = this.arrayField(value.thread, "turns", "thread turns")
      .map((turn) => this.record(turn, "thread turn"));
    return { ...value.thread, id, turns };
  }

  private summary(thread: Record<string, unknown>, receivedAt: string): ProviderSessionSummary {
    const externalSessionId = this.stringField(thread, "id", "thread id");
    const cwd = this.stringField(thread, "cwd", "thread cwd");
    const createdAt = this.timestampField(thread, "createdAt", "thread createdAt");
    const updatedAt = this.timestampField(thread, "updatedAt", "thread updatedAt");
    if (!isRecord(thread.status) || typeof thread.status.type !== "string") {
      throw new CodexProtocolError("Codex thread status is invalid");
    }
    const name = this.optionalString(thread.name);
    const preview = this.optionalString(thread.preview);
    return {
      ref: { providerId: "codex", externalSessionId },
      title: this.redactedString(name ?? preview),
      cwd: this.redactedString(cwd),
      state: this.sessionState(thread.status.type),
      sourceCreatedAt: createdAt,
      sourceUpdatedAt: updatedAt,
      receivedAt
    };
  }

  private turn(value: Record<string, unknown>, order: number, receivedAt: string): ProviderSessionTurn {
    return {
      externalTurnId: this.stringField(value, "id", "turn id"),
      order,
      state: this.turnState(typeof value.status === "string" ? value.status : "unknown"),
      sourceStartedAt: this.nullableTimestampField(value, "startedAt", "turn startedAt"),
      sourceCompletedAt: this.nullableTimestampField(value, "completedAt", "turn completedAt"),
      receivedAt
    };
  }

  private item(
    value: unknown,
    externalTurnId: string,
    order: number,
    receivedAt: string,
    toolNames: Map<string, string>
  ): ProviderSessionItem {
    const record = this.record(value, "thread item");
    const externalItemId = this.stringField(record, "id", "thread item id");
    const mapped = this.mapItem(record, toolNames);
    return {
      externalItemId,
      externalTurnId,
      ...mapped,
      order,
      sourceAt: null,
      receivedAt
    };
  }

  private callToolNames(values: unknown[]): Map<string, string> {
    const toolNames = new Map<string, string>();
    for (const value of values) {
      const item = this.record(value, "thread item");
      if (item.type !== "custom_tool_call" && item.type !== "customToolCall") continue;
      const callId = this.optionalString(item.call_id ?? item.callId);
      const name = this.optionalString(item.name);
      if (callId !== null && name !== null) toolNames.set(callId, name);
    }
    return toolNames;
  }

  private mapItem(item: Record<string, unknown>, toolNames: Map<string, string>): MappedItem {
    switch (item.type) {
      case "userMessage":
        return {
          role: "user",
          kind: "message",
          text: this.redactedString(this.userText(item.content)),
          name: null
        };
      case "agentMessage":
        return {
          role: "assistant",
          kind: "message",
          text: this.redactedString(this.optionalString(item.text)),
          name: null
        };
      case "reasoning":
        return {
          role: "assistant",
          kind: "reasoning",
          text: this.redactedString(this.stringArrayText(item.summary)),
          name: null
        };
      case "commandExecution":
        return {
          role: "tool",
          kind: "tool_result",
          text: this.redactedString(this.optionalString(item.aggregatedOutput)),
          name: this.redactedString(this.optionalString(item.command))
        };
      case "custom_tool_call":
      case "customToolCall":
        return {
          role: "assistant",
          kind: "tool_call",
          text: this.redactedString(this.optionalString(item.input)),
          name: this.redactedString(this.optionalString(item.name))
        };
      case "custom_tool_call_output":
      case "customToolCallOutput":
        return {
          role: "tool",
          kind: "tool_result",
          text: this.redactedString(this.outputText(item.output, 2000)),
          name: this.redactedString(this.callToolName(item, toolNames))
        };
      case "localShellCall":
        return {
          role: "tool",
          kind: "tool_result",
          text: this.redactedString(this.optionalString(item.output) ?? this.optionalString(item.aggregatedOutput)),
          name: this.redactedString(this.optionalString(item.command) ?? "shell")
        };
      case "fileChange":
        return this.fileChangeItem(item);
      case "imageGeneration":
        return this.toolItem(
          item,
          this.optionalString(item.path) ?? this.optionalString(item.description) ?? "imageGeneration"
        );
      case "mcpToolCall":
        return this.toolItem(item, this.joinName(item.server, item.tool));
      case "dynamicToolCall":
        return this.toolItem(item, this.optionalString(item.tool));
      case "webSearch":
        return {
          role: "assistant",
          kind: "tool_call",
          text: this.redactedString(this.optionalString(item.query)),
          name: "webSearch"
        };
      case "plan":
        return {
          role: "assistant",
          kind: "status",
          text: this.redactedString(this.optionalString(item.text)),
          name: "plan"
        };
      case "subAgentActivity":
        return {
          role: "assistant",
          kind: "subagent",
          text: this.optionalString(item.kind),
          name: this.optionalString(item.agentPath) ?? this.optionalString(item.agentThreadId)
        };
      case "collabAgentToolCall":
        return {
          role: "assistant",
          kind: "subagent",
          text: this.redactedString(this.optionalString(item.prompt)),
          name: this.optionalString(item.tool)
        };
      default:
        return { role: "unknown", kind: "unknown", text: null, name: null };
    }
  }

  private toolItem(item: Record<string, unknown>, name: string | null): MappedItem {
    const hasResult = item.result !== null && item.result !== undefined;
    return {
      role: hasResult ? "tool" : "assistant",
      kind: hasResult ? "tool_result" : "tool_call",
      text: hasResult ? this.redactedJson(item.result) : null,
      name: this.redactedString(name)
    };
  }

  private fileChangeItem(item: Record<string, unknown>): MappedItem {
    const changes = Array.isArray(item.changes)
      ? item.changes.filter((change): change is Record<string, unknown> => isRecord(change))
      : [];
    const paths = changes
      .map((change) => this.optionalString(change.path))
      .filter((path): path is string => path !== null);
    const text = changes
      .map((change) => {
        const path = this.optionalString(change.path);
        const diff = this.optionalString(change.diff);
        return diff === null ? path : [path, diff].filter((part): part is string => part !== null).join("\n");
      })
      .filter((part): part is string => part !== null)
      .join("\n\n")
      .slice(0, 2000);
    return {
      role: "tool",
      kind: "tool_result",
      text: this.redactedString(text.length > 0 ? text : null),
      name: this.redactedString(paths.length > 0 ? paths.join(", ") : "fileChange")
    };
  }

  private outputText(value: unknown, limit: number): string | null {
    if (!Array.isArray(value)) return null;
    const parts = value
      .filter((part): part is Record<string, unknown> => isRecord(part)
        && (part.type === "input_text" || part.type === "text"))
      .map((part) => this.optionalString(part.text))
      .filter((part): part is string => part !== null);
    if (parts.length === 0) return null;
    const text = parts.join("\n");
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  }

  private callToolName(item: Record<string, unknown>, toolNames: Map<string, string>): string | null {
    const callId = this.optionalString(item.call_id ?? item.callId);
    if (callId === null) return null;
    return toolNames.get(callId) ?? null;
  }

  private userText(value: unknown): string | null {
    if (!Array.isArray(value)) return null;
    const text = value
      .filter((part): part is Record<string, unknown> => isRecord(part) && part.type === "text")
      .map((part) => this.optionalString(part.text))
      .filter((part): part is string => part !== null);
    return text.length === 0 ? null : text.join("\n");
  }

  private stringArrayText(...values: unknown[]): string | null {
    const text = values.flatMap((value) => Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
      : []);
    return text.length === 0 ? null : text.join("\n");
  }

  private joinName(left: unknown, right: unknown): string | null {
    const parts = [this.optionalString(left), this.optionalString(right)]
      .filter((part): part is string => part !== null);
    return parts.length === 0 ? null : parts.join("/");
  }

  private redactedJson(value: unknown): string | null {
    const redacted = this.redactor.redact(value);
    return redacted === null || redacted === undefined ? null : JSON.stringify(redacted);
  }

  private redactedString(value: string | null): string | null {
    if (value === null) return null;
    return this.redactor.redact(value) as string;
  }

  private sessionState(value: string): ProviderSessionState {
    if (value === "active") return "active";
    if (value === "idle") return "idle";
    return "unknown";
  }

  private turnState(value: string): ProviderSessionTurnState {
    if (value === "inProgress") return "in_progress";
    if (value === "completed" || value === "failed") return value;
    if (value === "interrupted") return "cancelled";
    return "unknown";
  }

  private assertProvider(providerId: string, externalSessionId: string | null): void {
    if (providerId !== "codex") {
      throw this.failure(
        "PROTOCOL_INCOMPATIBLE",
        externalSessionId,
        false,
        `Codex session sync cannot read provider ${providerId}${externalSessionId ? ` session ${externalSessionId}` : ""}`
      );
    }
  }

  private syncError(error: unknown, externalSessionId: string | null): ProviderSessionSyncError {
    if (error instanceof ProviderSessionSyncError) return error;
    if (!(error instanceof CodexProtocolError)) {
      return this.failure(
        "UNKNOWN",
        externalSessionId,
        false,
        "Codex session synchronization failed"
      );
    }
    const lowerMessage = error.message.toLowerCase();
    if (/not found|unknown thread|does not exist/.test(lowerMessage)) {
      return this.failure("NOT_FOUND", externalSessionId, false, error.message);
    }
    if (/permission|access denied|unauthorized|forbidden/.test(lowerMessage)) {
      return this.failure("ACCESS_DENIED", externalSessionId, false, error.message);
    }
    if (/invalid cursor|cursor.*expired/.test(lowerMessage)) {
      return this.failure("INVALID_CURSOR", externalSessionId, false, error.message);
    }
    if (error.code === "CODEX_SESSION_SYNC_UNAVAILABLE"
      || error.code === "CODEX_BINARY_NOT_FOUND") {
      return this.failure("UNAVAILABLE", externalSessionId, false, error.message);
    }
    if (["CODEX_PROCESS_ERROR", "CODEX_PROCESS_EXIT", "CODEX_PROCESS_CLOSED"]
      .includes(error.code)) {
      return this.failure("TRANSIENT_FAILURE", externalSessionId, true, error.message);
    }
    if (error.code === "CODEX_PROVIDER_REF_MISMATCH"
      || error.code === "CODEX_PROTOCOL_ERROR"
      || (error.remoteCode !== null && [-32600, -32601, -32602].includes(error.remoteCode))) {
      return this.failure("PROTOCOL_INCOMPATIBLE", externalSessionId, false, error.message);
    }
    return this.failure("UNKNOWN", externalSessionId, false, error.message);
  }

  private failure(
    code: ProviderSessionSyncErrorCode,
    externalSessionId: string | null,
    retryable: boolean,
    message: string
  ): ProviderSessionSyncError {
    return new ProviderSessionSyncError({
      code,
      providerId: this.providerId,
      externalSessionId,
      retryable,
      message
    });
  }

  private record(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) throw new CodexProtocolError(`Codex ${field} is invalid`);
    return value;
  }

  private arrayField(value: Record<string, unknown>, key: string, field: string): unknown[] {
    const result = value[key];
    if (!Array.isArray(result)) throw new CodexProtocolError(`Codex ${field} is invalid`);
    return result;
  }

  private stringField(value: Record<string, unknown>, key: string, field: string): string {
    const result = value[key];
    if (typeof result !== "string" || result.length === 0) {
      throw new CodexProtocolError(`Codex ${field} is invalid`);
    }
    return result;
  }

  private timestampField(value: Record<string, unknown>, key: string, field: string): string {
    const result = value[key];
    if (!Number.isInteger(result)) throw new CodexProtocolError(`Codex ${field} is invalid`);
    return new Date((result as number) * 1_000).toISOString();
  }

  private nullableTimestampField(
    value: Record<string, unknown>,
    key: string,
    field: string
  ): string | null {
    const result = value[key];
    if (result === null || result === undefined) return null;
    return this.timestampField(value, key, field);
  }

  private optionalString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
  }
}
