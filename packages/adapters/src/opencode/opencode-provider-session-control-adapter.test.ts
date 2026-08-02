import { describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Part } from "@opencode-ai/sdk";
import { ProviderSessionSyncError } from "@nodra/application";
import {
  type OpenCodeProviderSessionControlAdapterOptions,
  OpenCodeProviderSessionControlAdapter
} from "./opencode-provider-session-control-adapter.js";

const sessionId = "session-control-fixture";
const ref = { providerId: "opencode", externalSessionId: sessionId };

interface PromptCall {
  id: string;
  text: string;
}

interface MessageInfo {
  id: string;
  role: "user" | "assistant";
  time: { created: number; completed?: number };
  parentID?: string;
  error?: unknown;
}

const messageEntry = (info: MessageInfo, parts: Part[] = []) => ({ info, parts });

const assistantInfo = (overrides: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id: "assistant-reply",
  sessionID: sessionId,
  role: "assistant",
  time: { created: 1, completed: 2 },
  parentID: "user-prompt",
  modelID: "gemma3:4b",
  providerID: "local-engine",
  mode: "build",
  path: { cwd: "/workspace", root: "/workspace" },
  cost: 0,
  tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
  ...overrides
});

const userInfo = (id: string, created: number): MessageInfo => ({
  id,
  role: "user",
  time: { created }
});

const fakeClient = (options: {
  before?: Array<{ info: MessageInfo; parts: Part[] }>;
  after?: Array<{ info: MessageInfo; parts: Part[] }>;
  promptError?: unknown;
  messagesError?: unknown;
  statuses?: Array<Record<string, { type: "idle" | "busy" } | undefined>>;
}) => {
  const calls: PromptCall[] = [];
  const statusQueue = [...(options.statuses ?? [])];
  const session = {
    promptAsync: vi.fn(async ({ path, body }: { path: { id: string }; body: { parts: Array<{ type: "text"; text: string }> } }) => {
      calls.push({ id: path.id, text: body.parts[0]?.text ?? "" });
      if (options.promptError) throw options.promptError;
      return { data: undefined };
    }),
    messages: vi.fn(async () => {
      if (options.messagesError) throw options.messagesError;
      const after = options.after ?? [];
      if (calls.length === 0) return { data: options.before ?? [] };
      return { data: [...(options.before ?? []), ...after] };
    }),
    status: vi.fn(async () => {
      const current = statusQueue.shift();
      return { data: current ?? {} };
    })
  };
  return { client: { session }, calls };
};

const adapter = (client: unknown, options: OpenCodeProviderSessionControlAdapterOptions = {}) =>
  new OpenCodeProviderSessionControlAdapter({
    createClient: () => client as ReturnType<typeof import("@opencode-ai/sdk")["createOpencodeClient"]>,
    ...options
  });

const turnInput = (text: string) => ({ ref, clientCommandId: "command", text });

describe("OpenCodeProviderSessionControlAdapter", () => {
  it("exposes control capabilities and forbids a local queue", async () => {
    const result = await adapter(fakeClient({}).client).capabilities();
    expect(result).toEqual({
      schemaVersion: 1,
      providerId: "opencode",
      read: { state: "compatible_unverified", reason: "opencode_session_control_required", action: "Run the OpenCode attached session control POC" },
      startTurn: { state: "compatible_unverified", reason: "opencode_session_control_required", action: "Run the OpenCode attached session control POC" },
      steer: { state: "compatible_unverified", reason: "opencode_session_control_required", action: "Run the OpenCode attached session control POC" },
      queue: { state: "unavailable", reason: "provider_session_local_queue_forbidden", action: null }
    });
  });

  it("starts a turn with promptAsync and returns the new user message id once the assistant reply completes", async () => {
    const fixtures = fakeClient({
      before: [messageEntry(userInfo("previous-user", 1))],
      after: [messageEntry(userInfo("user-prompt", 3)), messageEntry(assistantInfo({ parentID: "user-prompt", id: "assistant-reply" }))]
    });
    const result = await adapter(fixtures.client, { pollIntervalMs: 5 }).startTurn(turnInput("Continue the investigation"));
    expect(fixtures.client.session.promptAsync).toHaveBeenCalledWith({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text: "Continue the investigation" }] },
      throwOnError: true
    });
    expect(fixtures.calls).toHaveLength(1);
    expect(result).toEqual({ ref, externalTurnId: "user-prompt" });
  });

  it("keeps polling until the reply is linked to the new user message via parentID", async () => {
    const before = [messageEntry(userInfo("user-prompt", 3))];
    const fixtures = fakeClient({
      before,
      after: [messageEntry(assistantInfo({ parentID: "other-parent", id: "assistant-reply" }))]
    });
    const error = await adapter(fixtures.client, { pollIntervalMs: 5, executionTimeoutMs: 40 }).startTurn(turnInput("hello"))
      .catch((caught: unknown) => caught);
    expect(fixtures.client.session.messages.mock.calls.length).toBeGreaterThan(1);
    expect(error).toBeInstanceOf(ProviderSessionSyncError);
    expect((error as ProviderSessionSyncError).details.code).toBe("UNAVAILABLE");
  });

  it("steers identically to startTurn by sending a message to the session", async () => {
    const fixtures = fakeClient({
      before: [messageEntry(userInfo("user-steer", 1))],
      after: [messageEntry(userInfo("user-prompt", 3)), messageEntry(assistantInfo({ parentID: "user-prompt", id: "assistant-reply" }))]
    });
    const result = await adapter(fixtures.client, { pollIntervalMs: 5 }).steer({
      ref,
      externalTurnId: "user-steer",
      clientCommandId: "command-steer",
      text: "Focus on the failing test"
    });
    expect(fixtures.client.session.promptAsync).toHaveBeenCalledWith({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text: "Focus on the failing test" }] },
      throwOnError: true
    });
    expect(result).toEqual({ ref, externalTurnId: "user-prompt" });
  });

  it("maps a 404 prompt failure to NOT_FOUND and a TypeError to retryable UNAVAILABLE", async () => {
    const notFound = new Error("no session found");
    Object.assign(notFound, { statusCode: 404 });
    await expect(adapter(fakeClient({ promptError: notFound }).client).startTurn(turnInput("hello")))
      .rejects.toMatchObject({
        name: "ProviderSessionSyncError",
        details: { code: "NOT_FOUND", providerId: "opencode", externalSessionId: sessionId, retryable: false }
      });

    await expect(adapter(fakeClient({ promptError: new TypeError("fetch failed") }).client).startTurn(turnInput("hello")))
      .rejects.toMatchObject({
        name: "ProviderSessionSyncError",
        details: { code: "UNAVAILABLE", providerId: "opencode", externalSessionId: sessionId, retryable: true }
      });
  });

  it("keeps polling while the session stays busy after a step completed", async () => {
    const fixtures = fakeClient({
      before: [messageEntry(userInfo("previous-user", 1))],
      after: [messageEntry(userInfo("user-prompt", 3)), messageEntry(assistantInfo({ parentID: "user-prompt", id: "assistant-reply" }))],
      statuses: [
        { [sessionId]: { type: "busy" } },
        { [sessionId]: { type: "busy" } },
        { [sessionId]: { type: "idle" } }
      ]
    });
    const result = await adapter(fixtures.client, { pollIntervalMs: 5 }).startTurn(turnInput("Continue"));
    expect(fixtures.client.session.status.mock.calls.length).toBe(3);
    expect(result).toEqual({ ref, externalTurnId: "user-prompt" });
  });

  it("falls back to the completed-step heuristic when the status endpoint is unavailable", async () => {
    const fixtures = fakeClient({
      before: [messageEntry(userInfo("previous-user", 1))],
      after: [messageEntry(userInfo("user-prompt", 3)), messageEntry(assistantInfo({ parentID: "user-prompt", id: "assistant-reply" }))]
    });
    const session = fixtures.client.session as unknown as { status: ReturnType<typeof vi.fn> };
    session.status.mockRejectedValue(new Error("status endpoint down"));
    const result = await adapter(fixtures.client, { pollIntervalMs: 5 }).startTurn(turnInput("Continue"));
    expect(result).toEqual({ ref, externalTurnId: "user-prompt" });
  });

  it("surfaces an assistant message error as UNKNOWN with its data message", async () => {
    const fixtures = fakeClient({
      after: [
        messageEntry(userInfo("user-prompt", 3)),
        messageEntry(assistantInfo({
          parentID: "user-prompt",
          id: "assistant-reply",
          error: { name: "ProviderAuthError", data: { providerID: "local-engine", message: "provider auth expired" } }
        }))
      ]
    });
    await expect(adapter(fixtures.client, { pollIntervalMs: 5 }).startTurn(turnInput("hello")))
      .rejects.toMatchObject({
        details: { code: "UNKNOWN", providerId: "opencode", externalSessionId: sessionId, retryable: false, message: "provider auth expired" }
      });
  });

  it("times out a session that never completes with a non-retryable UNAVAILABLE error", async () => {
    const fixtures = fakeClient({
      before: [messageEntry(userInfo("previous-user", 1))],
      after: []
    });
    const timeoutError = await adapter(fixtures.client, { executionTimeoutMs: 30, pollIntervalMs: 5 }).startTurn(turnInput("never replies"))
      .catch((error: unknown) => error);
    expect(timeoutError).toBeInstanceOf(ProviderSessionSyncError);
    expect((timeoutError as ProviderSessionSyncError).details).toMatchObject({
      code: "UNAVAILABLE",
      providerId: "opencode",
      externalSessionId: sessionId,
      retryable: false
    });
    expect((timeoutError as ProviderSessionSyncError).message).toMatch(/timed out after 30ms/);
  });

  it("rejects a mismatched provider reference before prompting", async () => {
    const fixtures = fakeClient({});
    await expect(adapter(fixtures.client).startTurn({
      ref: { providerId: "codex", externalSessionId: "thread" },
      clientCommandId: "command",
      text: "hello"
    })).rejects.toMatchObject({ details: { code: "PROTOCOL_INCOMPATIBLE", providerId: "opencode", externalSessionId: "thread" } });
    expect(fixtures.client.session.promptAsync).not.toHaveBeenCalled();
  });
});
