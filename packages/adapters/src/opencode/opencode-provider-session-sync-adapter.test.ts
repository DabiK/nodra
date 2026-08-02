import { describe, expect, it, vi } from "vitest";
import {
  OpenCodeProviderSessionSyncAdapter,
  type OpenCodeProviderSessionSyncAdapterOptions
} from "./opencode-provider-session-sync-adapter.js";

const receivedAt = "2026-08-02T12:00:00.000Z";

interface FakeClient {
  session: {
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    messages: ReturnType<typeof vi.fn>;
  };
}

const fakeClient = (): FakeClient => ({
  session: {
    list: vi.fn(),
    get: vi.fn(),
    messages: vi.fn()
  }
});

const adapter = (fake: FakeClient, now: () => string = () => receivedAt) =>
  new OpenCodeProviderSessionSyncAdapter(
    {
      createClient: (() => fake) as unknown as NonNullable<
        OpenCodeProviderSessionSyncAdapterOptions["createClient"]
      >
    },
    now
  );

const session = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "session-1",
  projectID: "project-fixture",
  directory: "/workspace",
  title: "Fixture session",
  version: "1.18.5",
  time: { created: 1_000, updated: 2_000 },
  ...overrides
});

const textPart = (text: string, messageID = "m"): Record<string, unknown> => ({
  id: `part-${messageID}`,
  sessionID: "session-1",
  messageID,
  type: "text",
  text
});

const reasoningPart = (text: string, messageID = "m"): Record<string, unknown> => ({
  id: `reasoning-${messageID}`,
  sessionID: "session-1",
  messageID,
  type: "reasoning",
  text
});

const toolPart = (tool: string, messageID = "m"): Record<string, unknown> => ({
  id: `tool-${messageID}`,
  sessionID: "session-1",
  messageID,
  type: "tool",
  callID: `call-${messageID}`,
  tool,
  state: { status: "completed" }
});

const agentPart = (name: string, messageID = "m"): Record<string, unknown> => ({
  id: `agent-${messageID}`,
  sessionID: "session-1",
  messageID,
  type: "agent",
  name
});

const subtaskPart = (agent: string, prompt: string, description: string, messageID = "m"): Record<string, unknown> => ({
  id: `subtask-${messageID}`,
  sessionID: "session-1",
  messageID,
  type: "subtask",
  agent,
  prompt,
  description
});

const taskToolPart = (messageID = "m"): Record<string, unknown> => ({
  id: `task-tool-${messageID}`,
  sessionID: "session-1",
  messageID,
  type: "tool",
  callID: `call-${messageID}`,
  tool: "task",
  state: {
    status: "completed",
    input: {
      description: "Créer toto.txt avec histoire",
      prompt: "Create a file named toto.txt with a story inside"
    },
    output: "<task id=\"ses_sub\">\n<task_result>\nCreated: toto.txt\n</task_result>\n</task>"
  }
});

const entry = (info: Record<string, unknown>, parts: unknown[] = []): Record<string, unknown> => ({
  info: { sessionID: "session-1", ...info },
  parts
});

describe("OpenCodeProviderSessionSyncAdapter", () => {
  it("reports unverified capabilities for snapshot operations and unavailable for the rest", async () => {
    const fake = fakeClient();

    expect(await adapter(fake).capabilities()).toEqual({
      schemaVersion: 1,
      providerId: "opencode",
      listSessions: {
        state: "compatible_unverified",
        reason: "opencode_session_sync_required",
        action: "Run the OpenCode session synchronization POC"
      },
      readSession: {
        state: "compatible_unverified",
        reason: "opencode_session_sync_required",
        action: "Run the OpenCode session synchronization POC"
      },
      readHistory: { state: "unavailable", reason: "opencode_history_pagination_unavailable", action: null },
      subscribe: { state: "unavailable", reason: "opencode_external_subscription_unavailable", action: null },
      cursorResume: { state: "unavailable", reason: "opencode_cursor_resume_unavailable", action: null },
      attachedControl: { state: "unavailable", reason: "opencode_attached_control_unavailable", action: null }
    });
    expect(fake.session.list).not.toHaveBeenCalled();
  });

  it("maps listed sessions with all summary fields in provider order", async () => {
    const fake = fakeClient();
    fake.session.list.mockResolvedValue({
      data: [
        session({
          id: "s1",
          title: "First session",
          directory: "/workspace/a",
          time: { created: 1_000, updated: 1_500 }
        }),
        session({
          id: "s2",
          title: "",
          directory: "/workspace/b",
          time: { created: 2_000, updated: 2_500 }
        })
      ]
    });

    const page = await adapter(fake).listSessions({ providerId: "opencode", cursor: "ignored", limit: 10 });

    expect(fake.session.list).toHaveBeenCalledWith({ throwOnError: true });
    expect(page).toEqual({
      sessions: [
        {
          ref: { providerId: "opencode", externalSessionId: "s1" },
          title: "First session",
          cwd: "/workspace/a",
          state: "idle",
          sourceCreatedAt: "1970-01-01T00:00:01.000Z",
          sourceUpdatedAt: "1970-01-01T00:00:01.500Z",
          receivedAt
        },
        {
          ref: { providerId: "opencode", externalSessionId: "s2" },
          title: null,
          cwd: "/workspace/b",
          state: "idle",
          sourceCreatedAt: "1970-01-01T00:00:02.000Z",
          sourceUpdatedAt: "1970-01-01T00:00:02.500Z",
          receivedAt
        }
      ],
      nextCursor: null
    });
  });

  it("rejects a mismatched provider id without touching the client", async () => {
    const fake = fakeClient();

    await expect(adapter(fake).listSessions({ providerId: "codex" })).rejects.toMatchObject({
      name: "ProviderSessionSyncError",
      details: {
        code: "PROTOCOL_INCOMPATIBLE",
        providerId: "opencode",
        externalSessionId: null,
        retryable: false
      }
    });
    await expect(adapter(fake).readSession({
      providerId: "codex",
      externalSessionId: "ses"
    })).rejects.toMatchObject({
      details: {
        code: "PROTOCOL_INCOMPATIBLE",
        providerId: "opencode",
        externalSessionId: "ses",
        retryable: false
      }
    });
    expect(fake.session.list).not.toHaveBeenCalled();
    expect(fake.session.get).not.toHaveBeenCalled();
  });

  it("maps messages into turns and items, sorting by time.created", async () => {
    const fake = fakeClient();
    fake.session.get.mockResolvedValue({ data: session() });
    fake.session.messages.mockResolvedValue({
      data: [
        entry({ id: "m5", role: "assistant", parentID: "m1", time: { created: 6, completed: 60 } },
          [toolPart("bash", "m5")]),
        entry({ id: "m4", role: "assistant", parentID: "m1", time: { created: 5, completed: 50 } },
          [reasoningPart("thinking about it", "m4")]),
        entry({ id: "m3", role: "tool", time: { created: 4 } }, []),
        entry({ id: "m2", role: "assistant", parentID: "m1", time: { created: 3, completed: 30 } },
          [textPart("hi ", "m2"), textPart("there", "m2")]),
        entry({ id: "m1", role: "user", time: { created: 2 } }, [textPart("hello", "m1")]),
        entry({ id: "m0", role: "assistant", time: { created: 1 } }, [textPart("preamble", "m0")]),
        entry({ id: "m6", role: "assistant", parentID: "m1", time: { created: 7, completed: 70 } },
          [agentPart("prelude", "m6"), subtaskPart("nested/codex", "Refactor the module", "delegated refactor", "m6"), textPart("Visible summary", "m6")]),
        entry({ id: "m7", role: "assistant", parentID: "m1", time: { created: 8, completed: 80 } },
          [agentPart("orphan", "m7"), subtaskPart("delegate", "Do the delegated work", "delegation description", "m7")]),
        entry({ id: "m8", role: "assistant", parentID: "m1", time: { created: 9, completed: 90 } },
          [reasoningPart("delegating to a subagent", "m8"), taskToolPart("m8")])
      ]
    });

    const snapshot = await adapter(fake).readSession({
      providerId: "opencode",
      externalSessionId: "session-1"
    });

    expect(fake.session.get).toHaveBeenCalledWith({
      path: { id: "session-1" },
      throwOnError: true
    });
    expect(fake.session.messages).toHaveBeenCalledWith({
      path: { id: "session-1" },
      query: { directory: "/workspace" },
      throwOnError: true
    });
    expect(snapshot.session).toEqual({
      ref: { providerId: "opencode", externalSessionId: "session-1" },
      title: "Fixture session",
      cwd: "/workspace",
      state: "idle",
      sourceCreatedAt: "1970-01-01T00:00:01.000Z",
      sourceUpdatedAt: "1970-01-01T00:00:02.000Z",
      receivedAt
    });
    expect(snapshot.turns).toEqual([
      {
        externalTurnId: "m1",
        order: 0,
        state: "completed",
        sourceStartedAt: "1970-01-01T00:00:00.002Z",
        sourceCompletedAt: "1970-01-01T00:00:00.090Z",
        receivedAt
      }
    ]);
    expect(snapshot.items).toEqual([
      { externalItemId: "m0", externalTurnId: null, role: "assistant", kind: "message", order: 0, text: "preamble", name: null, sourceAt: "1970-01-01T00:00:00.001Z", receivedAt },
      { externalItemId: "m1", externalTurnId: "m1", role: "user", kind: "message", order: 1, text: "hello", name: null, sourceAt: "1970-01-01T00:00:00.002Z", receivedAt },
      { externalItemId: "m2", externalTurnId: "m1", role: "assistant", kind: "message", order: 2, text: "hi there", name: null, sourceAt: "1970-01-01T00:00:00.003Z", receivedAt },
      { externalItemId: "m3", externalTurnId: "m1", role: "tool", kind: "tool_result", order: 3, text: null, name: null, sourceAt: "1970-01-01T00:00:00.004Z", receivedAt },
      { externalItemId: "m4", externalTurnId: "m1", role: "assistant", kind: "reasoning", order: 4, text: "thinking about it", name: null, sourceAt: "1970-01-01T00:00:00.005Z", receivedAt },
      { externalItemId: "m5", externalTurnId: "m1", role: "assistant", kind: "tool_call", order: 5, text: null, name: "bash", sourceAt: "1970-01-01T00:00:00.006Z", receivedAt },
      { externalItemId: "m6", externalTurnId: "m1", role: "assistant", kind: "subagent", order: 6, text: "Visible summary", name: "nested/codex", sourceAt: "1970-01-01T00:00:00.007Z", receivedAt },
      { externalItemId: "m7", externalTurnId: "m1", role: "assistant", kind: "subagent", order: 7, text: "Do the delegated work", name: "delegate", sourceAt: "1970-01-01T00:00:00.008Z", receivedAt },
      { externalItemId: "m8", externalTurnId: "m1", role: "assistant", kind: "subagent", order: 8, text: "Créer toto.txt avec histoire", name: "task", sourceAt: "1970-01-01T00:00:00.009Z", receivedAt }
    ]);
    expect(snapshot.cursor).toBeNull();
  });

  it("marks the last unanswered user message as in_progress and completed ones as completed", async () => {
    const fake = fakeClient();
    fake.session.get.mockResolvedValue({ data: session() });
    fake.session.messages.mockResolvedValue({
      data: [
        entry({ id: "user-1", role: "user", time: { created: 1 } }, [textPart("first", "user-1")]),
        entry({ id: "assistant-1", role: "assistant", parentID: "user-1", time: { created: 2, completed: 3 } },
          [textPart("answered", "assistant-1")]),
        entry({ id: "user-2", role: "user", time: { created: 4 } }, [textPart("second", "user-2")])
      ]
    });

    const snapshot = await adapter(fake).readSession({
      providerId: "opencode",
      externalSessionId: "session-1"
    });

    expect(snapshot.turns).toEqual([
      {
        externalTurnId: "user-1",
        order: 0,
        state: "completed",
        sourceStartedAt: "1970-01-01T00:00:00.001Z",
        sourceCompletedAt: "1970-01-01T00:00:00.003Z",
        receivedAt
      },
      {
        externalTurnId: "user-2",
        order: 1,
        state: "in_progress",
        sourceStartedAt: "1970-01-01T00:00:00.004Z",
        sourceCompletedAt: null,
        receivedAt
      }
    ]);
  });

  it("falls back to session.list to resolve a directory when get fails with a 400", async () => {
    const fake = fakeClient();
    const ambiguous = new Error("session is ambiguous");
    (ambiguous as { statusCode?: number }).statusCode = 400;
    fake.session.get
      .mockRejectedValueOnce(ambiguous)
      .mockResolvedValueOnce({ data: session() });
    fake.session.list.mockResolvedValue({
      data: [session({ id: "session-1", directory: "/workspace" })]
    });
    fake.session.messages.mockResolvedValue({ data: [] });

    const snapshot = await adapter(fake).readSession({
      providerId: "opencode",
      externalSessionId: "session-1"
    });

    expect(fake.session.get).toHaveBeenCalledTimes(2);
    expect(fake.session.get).toHaveBeenLastCalledWith({
      path: { id: "session-1" },
      query: { directory: "/workspace" },
      throwOnError: true
    });
    expect(fake.session.messages).toHaveBeenCalledWith({
      path: { id: "session-1" },
      query: { directory: "/workspace" },
      throwOnError: true
    });
    expect(snapshot.session.cwd).toBe("/workspace");
  });

  it("maps a 400 with no resolvable directory into TRANSIENT_FAILURE", async () => {
    const fake = fakeClient();
    const badRequest = new Error("bad request");
    (badRequest as { statusCode?: number }).statusCode = 400;
    fake.session.get.mockRejectedValue(badRequest);
    fake.session.list.mockResolvedValue({ data: [] });

    await expect(adapter(fake).readSession({
      providerId: "opencode",
      externalSessionId: "session-1"
    })).rejects.toMatchObject({
      name: "ProviderSessionSyncError",
      details: {
        code: "TRANSIENT_FAILURE",
        providerId: "opencode",
        externalSessionId: "session-1",
        retryable: true
      }
    });
  });

  it("maps 404 and not-found messages into NOT_FOUND and network failures into UNAVAILABLE", async () => {
    const notFound = fakeClient();
    const missing = new Error("session not found");
    (missing as { statusCode?: number }).statusCode = 404;
    notFound.session.get.mockRejectedValue(missing);

    await expect(adapter(notFound).readSession({
      providerId: "opencode",
      externalSessionId: "missing"
    })).rejects.toMatchObject({
      name: "ProviderSessionSyncError",
      details: {
        code: "NOT_FOUND",
        providerId: "opencode",
        externalSessionId: "missing",
        retryable: false
      }
    });

    const byMessage = fakeClient();
    byMessage.session.get.mockRejectedValue(new Error("No session exists for this directory"));

    await expect(adapter(byMessage).readSession({
      providerId: "opencode",
      externalSessionId: "missing"
    })).rejects.toMatchObject({
      details: { code: "NOT_FOUND", retryable: false }
    });

    const network = fakeClient();
    network.session.get.mockRejectedValue(new TypeError("fetch failed"));

    await expect(adapter(network).readSession({
      providerId: "opencode",
      externalSessionId: "session-1"
    })).rejects.toMatchObject({
      details: { code: "UNAVAILABLE", retryable: true }
    });
  });

  it("rejects readHistory and subscribe as unavailable", async () => {
    const fake = fakeClient();

    await expect(adapter(fake).readHistory({
      ref: { providerId: "opencode", externalSessionId: "session-1" }
    })).rejects.toMatchObject({
      name: "ProviderSessionSyncError",
      details: { code: "UNAVAILABLE", retryable: false }
    });
    const iterator = adapter(fake).subscribe({
      ref: { providerId: "opencode", externalSessionId: "session-1" }
    })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({
      details: { code: "UNAVAILABLE", retryable: false }
    });
    expect(fake.session.list).not.toHaveBeenCalled();
    expect(fake.session.get).not.toHaveBeenCalled();
  });
});
