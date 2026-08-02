import { createOpencodeClient, type Part, type Session } from "@opencode-ai/sdk";
import {
  ProviderSessionSyncError,
  type ProviderHistoryPage,
  type ProviderHistoryQuery,
  type ProviderSessionEvent,
  type ProviderSessionItem,
  type ProviderSessionItemKind,
  type ProviderSessionItemRole,
  type ProviderSessionListQuery,
  type ProviderSessionPage,
  type ProviderSessionRef,
  type ProviderSessionSnapshot,
  type ProviderSessionState,
  type ProviderSessionSummary,
  type ProviderSessionSyncCapabilities,
  type ProviderSessionSyncErrorCode,
  type ProviderSessionSyncPort,
  type ProviderSessionTurn,
  type ProviderSessionTurnState,
  type ProviderSubscription
} from "@nodra/application";

type Clock = () => string;

type OpenCodeClient = ReturnType<typeof createOpencodeClient>;

interface MessageEntry {
  info: {
    id: string;
    role: string;
    parentID?: string;
    time: {
      created: number;
      completed?: number;
    };
  };
  parts: Part[];
}

export interface OpenCodeProviderSessionSyncAdapterOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  createClient?: (baseUrl: string, fetchImpl: typeof fetch) => OpenCodeClient;
}

const unavailable = (reason: string) => ({
  state: "unavailable" as const,
  reason,
  action: null
});

export class OpenCodeProviderSessionSyncAdapter implements ProviderSessionSyncPort {
  readonly providerId = "opencode";
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly createClientImplementation: OpenCodeProviderSessionSyncAdapterOptions["createClient"] | null;

  constructor(
    options: OpenCodeProviderSessionSyncAdapterOptions = {},
    private readonly now: Clock = () => new Date().toISOString()
  ) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:4096").replace(/\/+$/, "");
    this.fetchImplementation = options.fetch ?? fetch;
    this.createClientImplementation = options.createClient ?? null;
  }

  async capabilities(): Promise<ProviderSessionSyncCapabilities> {
    const compatibleUnverified = {
      state: "compatible_unverified" as const,
      reason: "opencode_session_sync_required",
      action: "Run the OpenCode session synchronization POC"
    };
    return {
      schemaVersion: 1,
      providerId: "opencode",
      listSessions: compatibleUnverified,
      readSession: compatibleUnverified,
      readHistory: unavailable("opencode_history_pagination_unavailable"),
      subscribe: unavailable("opencode_external_subscription_unavailable"),
      cursorResume: unavailable("opencode_cursor_resume_unavailable"),
      attachedControl: unavailable("opencode_attached_control_unavailable")
    };
  }

  async listSessions(query: ProviderSessionListQuery): Promise<ProviderSessionPage> {
    this.assertProvider(query.providerId, null);
    try {
      return await this.withClient(async (client) => {
        const result = await client.session.list({ throwOnError: true });
        const receivedAt = this.now();
        return {
          sessions: result.data.map((session) => this.summary(session, receivedAt)),
          nextCursor: null
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
        const { session, directory } = await this.fetchSession(client, ref.externalSessionId);
        const messages = (await client.session.messages({
          path: { id: ref.externalSessionId },
          ...(directory ? { query: { directory } } : {}),
          throwOnError: true
        })).data;
        const receivedAt = this.now();
        const mapped = this.mapMessages(messages, receivedAt);
        return {
          session: this.summary(session, receivedAt),
          turns: mapped.turns,
          items: mapped.items,
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
      "OpenCode history pagination is unavailable; use readSession for a full snapshot"
    );
  }

  subscribe(input: ProviderSubscription): AsyncIterable<ProviderSessionEvent> {
    this.assertProvider(input.ref.providerId, input.ref.externalSessionId);
    const error = this.failure(
      "UNAVAILABLE",
      input.ref.externalSessionId,
      false,
      "OpenCode external session subscription is unavailable"
    );
    const iterator: AsyncIterableIterator<ProviderSessionEvent> = {
      next: async () => { throw error; },
      [Symbol.asyncIterator]() { return this; }
    };
    return iterator;
  }

  private async withClient<T>(operation: (client: OpenCodeClient) => Promise<T>): Promise<T> {
    const client = this.createClientImplementation
      ? this.createClientImplementation(this.baseUrl, this.fetchImplementation)
      : createOpencodeClient({
          baseUrl: this.baseUrl,
          fetch: this.fetchImplementation
        });
    return operation(client);
  }

  private async fetchSession(
    client: OpenCodeClient,
    externalSessionId: string
  ): Promise<{ session: Session; directory: string | null }> {
    try {
      const session = (await client.session.get({
        path: { id: externalSessionId },
        throwOnError: true
      })).data;
      return { session, directory: this.optionalString(session.directory) };
    } catch (error) {
      if (this.errorStatus(error) !== 400) throw error;
      const listed = (await client.session.list({ throwOnError: true })).data;
      const found = listed.find((candidate) => candidate.id === externalSessionId);
      if (!found) throw error;
      return {
        session: (await client.session.get({
          path: { id: externalSessionId },
          query: { directory: found.directory },
          throwOnError: true
        })).data,
        directory: found.directory
      };
    }
  }

  private mapMessages(
    entries: MessageEntry[],
    receivedAt: string
  ): { turns: ProviderSessionTurn[]; items: ProviderSessionItem[] } {
    const sorted = [...entries].sort((a, b) => a.info.time.created - b.info.time.created);
    const userEntries = sorted.filter((entry) => this.mapRole(entry.info.role) === "user");
    const turns = userEntries.map((entry, order) => {
      const replies = sorted.filter(
        (candidate) =>
          this.mapRole(candidate.info.role) === "assistant"
          && candidate.info.parentID === entry.info.id
          && candidate.info.time.completed !== undefined
      );
      const lastReply = replies[replies.length - 1];
      const completed = replies.length > 0;
      return {
        externalTurnId: entry.info.id,
        order,
        state: completed || order < userEntries.length - 1 ? ("completed" as const) : ("in_progress" as const),
        sourceStartedAt: new Date(entry.info.time.created).toISOString(),
        sourceCompletedAt: completed
          ? new Date(lastReply!.info.time.completed!).toISOString()
          : null,
        receivedAt
      };
    });
    let currentTurnId: string | null = null;
    const items = sorted.map((entry, order) => {
      const role = this.mapRole(entry.info.role);
      const text = this.messageText(entry.parts);
      if (role === "user") currentTurnId = entry.info.id;
      const kind = this.mapKind(entry.parts, role, text);
      const item: ProviderSessionItem = {
        externalItemId: entry.info.id,
        externalTurnId: currentTurnId,
        role,
        kind,
        order,
        text: kind === "subagent"
          ? (text ?? this.subagentText(entry.parts))
          : kind === "reasoning"
            ? (text ?? this.reasoningText(entry.parts))
            : text,
        name: kind === "subagent"
          ? this.subagentName(entry.parts)
          : role === "assistant" ? this.toolName(entry.parts) : null,
        sourceAt: new Date(entry.info.time.created).toISOString(),
        receivedAt
      };
      return item;
    });
    return { turns, items };
  }

  private summary(session: Session, receivedAt: string): ProviderSessionSummary {
    return {
      ref: { providerId: "opencode", externalSessionId: session.id },
      title: this.optionalString(session.title),
      cwd: this.optionalString(session.directory),
      state: "idle" as ProviderSessionState,
      sourceCreatedAt: new Date(session.time.created).toISOString(),
      sourceUpdatedAt: new Date(session.time.updated).toISOString(),
      receivedAt
    };
  }

  private mapRole(role: string): ProviderSessionItemRole {
    if (role === "user" || role === "assistant" || role === "tool" || role === "system") return role;
    return "unknown";
  }

  private mapKind(parts: Part[], role: ProviderSessionItemRole, text: string | null): ProviderSessionItemKind {
    if (role === "tool") return "tool_result";
    if (role === "assistant") {
      if (this.taskPart(parts) !== null) return "subagent";
      if (parts.some((part) => part.type === "agent" || part.type === "subtask")) return "subagent";
      if (text !== null) return "message";
      if (parts.some((part) => part.type === "reasoning")) return "reasoning";
      if (parts.some((part) => part.type === "tool")) return "tool_call";
      return "message";
    }
    return "message";
  }

  private taskPart(parts: Part[]): Extract<Part, { type: "tool" }> | null {
    const tool = parts.find(
      (part): part is Extract<Part, { type: "tool" }> => part.type === "tool" && part.tool === "task"
    );
    return tool ?? null;
  }

  private subagentName(parts: Part[]): string | null {
    if (this.taskPart(parts) !== null) return "task";
    const subtask = parts.find((part) => part.type === "subtask");
    if (subtask && subtask.agent.length > 0) return subtask.agent;
    const agent = parts.find((part) => part.type === "agent");
    return agent ? agent.name : null;
  }

  private subagentText(parts: Part[]): string | null {
    const task = this.taskPart(parts);
    if (task !== null) {
      const input = task.state.input;
      const description = typeof input.description === "string" && input.description.length > 0
        ? input.description
        : null;
      const prompt = typeof input.prompt === "string" && input.prompt.length > 0 ? input.prompt : null;
      return description ?? prompt;
    }
    const subtask = parts.find((part) => part.type === "subtask");
    if (!subtask) return null;
    return subtask.prompt.length > 0 ? subtask.prompt : (subtask.description.length > 0 ? subtask.description : null);
  }

  private reasoningText(parts: Part[]): string | null {
    const reasoning = parts.find((part) => part.type === "reasoning");
    return reasoning && reasoning.text.length > 0 ? reasoning.text : null;
  }

  private messageText(parts: Part[]): string | null {
    const text = parts
      .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("");
    return text.length > 0 ? text : null;
  }

  private toolName(parts: Part[]): string | null {
    const tool = parts.find((part) => part.type === "tool");
    return tool ? tool.tool : null;
  }

  private assertProvider(providerId: string, externalSessionId: string | null): void {
    if (providerId !== "opencode") {
      throw this.failure(
        "PROTOCOL_INCOMPATIBLE",
        externalSessionId,
        false,
        `OpenCode session sync cannot read provider ${providerId}${externalSessionId ? ` session ${externalSessionId}` : ""}`
      );
    }
  }

  private syncError(error: unknown, externalSessionId: string | null): ProviderSessionSyncError {
    if (error instanceof ProviderSessionSyncError) return error;
    if (error instanceof Error) {
      const lowerMessage = error.message.toLowerCase();
      const status = this.errorStatus(error);
      if (status === 404 || /not found|no session|does not exist/.test(lowerMessage)) {
        return this.failure("NOT_FOUND", externalSessionId, false, error.message);
      }
      if (status === 400) {
        return this.failure("TRANSIENT_FAILURE", externalSessionId, true, error.message);
      }
    }
    if (error instanceof TypeError) {
      return this.failure(
        "UNAVAILABLE",
        externalSessionId,
        true,
        "OpenCode server is unreachable over HTTP"
      );
    }
    return this.failure(
      "UNKNOWN",
      externalSessionId,
      false,
      error instanceof Error ? error.message : "OpenCode session synchronization failed"
    );
  }

  private errorStatus(error: unknown): number | null {
    if (!(error instanceof Error)) return null;
    const direct = (error as { statusCode?: unknown }).statusCode;
    if (typeof direct === "number") return direct;
    const cause = error.cause as { status?: unknown } | undefined;
    if (cause && typeof cause.status === "number") return cause.status;
    return null;
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

  private optionalString(value: string): string | null {
    return value.length > 0 ? value : null;
  }
}
