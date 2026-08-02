import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CodexProcessLauncher } from "./codex-process-launcher.js";
import { CodexProviderSessionSyncAdapter } from "./codex-provider-session-sync-adapter.js";

type Message = Record<string, unknown>;

const fixture = async (name: string): Promise<Message[]> => {
  const path = fileURLToPath(new URL(`./fixtures/${name}.jsonl`, import.meta.url));
  return (await readFile(path, "utf8")).trim().split("\n")
    .map((line) => (JSON.parse(line) as { message: Message }).message);
};

const processFixture = (
  receive: (message: Message, send: (message: Message) => void) => void
): { process: ChildProcessWithoutNullStreams; received: Message[]; killed: string[] } => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const emitter = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill(signal?: string): boolean;
  };
  const received: Message[] = [];
  const killed: string[] = [];
  let buffer = "";
  stdin.on("data", (chunk) => {
    buffer += chunk.toString();
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n");
      const message = JSON.parse(buffer.slice(0, index)) as Message;
      buffer = buffer.slice(index + 1);
      received.push(message);
      receive(message, (response) => stdout.write(`${JSON.stringify(response)}\n`));
    }
  });
  emitter.stdin = stdin;
  emitter.stdout = stdout;
  emitter.stderr = stderr;
  emitter.kill = (signal) => {
    killed.push(signal ?? "default");
    queueMicrotask(() => emitter.emit("exit", 0, null));
    return true;
  };
  return {
    process: emitter as unknown as ChildProcessWithoutNullStreams,
    received,
    killed
  };
};

const launcher = (process: ChildProcessWithoutNullStreams): CodexProcessLauncher => ({
  launch: () => process
});

const receivedAt = "2026-08-01T15:00:00.000Z";

describe("CodexProviderSessionSyncAdapter", () => {
  it("lists Codex sessions through the stable RPC and returns redacted neutral summaries", async () => {
    const responses = await fixture("session-list");
    const child = processFixture((message, send) => {
      if ("id" in message) send({ ...responses.shift()!, id: message.id });
    });
    const adapter = new CodexProviderSessionSyncAdapter(
      launcher(child.process),
      () => receivedAt
    );

    const page = await adapter.listSessions({
      providerId: "codex",
      cursor: "cursor/page-1",
      limit: 2
    });

    expect(child.received).toEqual([
      {
        method: "initialize",
        id: 1,
        params: { clientInfo: { name: "nodra", title: "Nodra", version: "0.1.0" } }
      },
      { method: "initialized", params: {} },
      { method: "thread/list", id: 2, params: { cursor: "cursor/page-1", limit: 2 } }
    ]);
    expect(page).toEqual({
      sessions: [
        {
          ref: { providerId: "codex", externalSessionId: "thr_list_1" },
          title: "Bearer [REDACTED]",
          cwd: "/workspace/api_key=[REDACTED]",
          state: "active",
          sourceCreatedAt: "2026-08-01T12:00:00.000Z",
          sourceUpdatedAt: "2026-08-01T13:00:00.000Z",
          receivedAt
        },
        {
          ref: { providerId: "codex", externalSessionId: "thr_list_2" },
          title: "Archived fixture",
          cwd: "/workspace/two",
          state: "unknown",
          sourceCreatedAt: "2026-07-31T13:00:00.000Z",
          sourceUpdatedAt: "2026-07-31T14:00:00.000Z",
          receivedAt
        }
      ],
      nextCursor: "cursor/page-2"
    });
    expect(JSON.stringify(page)).not.toContain("must-not-leak");
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("reads a full Codex session in stable provider order with safe item mappings", async () => {
    const responses = await fixture("session-read");
    const child = processFixture((message, send) => {
      if ("id" in message) send({ ...responses.shift()!, id: message.id });
    });
    const adapter = new CodexProviderSessionSyncAdapter(
      launcher(child.process),
      () => receivedAt
    );

    const snapshot = await adapter.readSession({
      providerId: "codex",
      externalSessionId: "thr_read_1"
    });

    expect(child.received.at(-1)).toEqual({
      method: "thread/read",
      id: 3,
      params: { threadId: "sub_thr_1", includeTurns: true }
    });
    expect(snapshot).toEqual({
      session: {
        ref: { providerId: "codex", externalSessionId: "thr_read_1" },
        title: "Read fixture",
        cwd: "/workspace",
        state: "idle",
        sourceCreatedAt: "2026-08-01T12:00:00.000Z",
        sourceUpdatedAt: "2026-08-01T14:00:00.000Z",
        receivedAt
      },
      turns: [
        {
          externalTurnId: "turn_1",
          order: 0,
          state: "completed",
          sourceStartedAt: "2026-08-01T12:01:00.000Z",
          sourceCompletedAt: "2026-08-01T12:02:00.000Z",
          receivedAt
        },
        {
          externalTurnId: "turn_2",
          order: 1,
          state: "in_progress",
          sourceStartedAt: "2026-08-01T14:00:00.000Z",
          sourceCompletedAt: null,
          receivedAt
        }
      ],
      items: [
        { externalItemId: "item_user", externalTurnId: "turn_1", role: "user", kind: "message", order: 0, text: "Use api_key=[REDACTED]", name: null, sourceAt: null, receivedAt },
        { externalItemId: "item_reasoning", externalTurnId: "turn_1", role: "assistant", kind: "reasoning", order: 1, text: "Bearer [REDACTED]", name: null, sourceAt: null, receivedAt },
        { externalItemId: "item_agent", externalTurnId: "turn_1", role: "assistant", kind: "message", order: 2, text: "Done with [REDACTED]", name: null, sourceAt: null, receivedAt },
        { externalItemId: "item_tool", externalTurnId: "turn_1", role: "tool", kind: "tool_result", order: 3, text: "ok password=[REDACTED]", name: "npm test --token=[REDACTED]", sourceAt: null, receivedAt },
        { externalItemId: "item_future", externalTurnId: "turn_1", role: "unknown", kind: "unknown", order: 4, text: null, name: null, sourceAt: null, receivedAt },
        { externalItemId: "item_subagent_started", externalTurnId: "turn_1", role: "assistant", kind: "subagent", order: 5, text: "started", name: "nested/codex", sourceAt: null, receivedAt, subagent: {
          subSessionId: "sub_thr_1",
          status: "completed",
          model: null,
          startedAt: "2026-08-02T18:05:16.000Z",
          finishedAt: "2026-08-02T18:05:52.000Z",
          report: "Fichier créé: story-1.txt",
          transcript: [
            { externalItemId: "sub_user", role: "user", kind: "message", order: 0, text: "Créer story-1.txt", name: null, sourceAt: null },
            { externalItemId: "sub_agent", role: "assistant", kind: "message", order: 1, text: "Fichier créé: story-1.txt", name: null, sourceAt: null }
          ]
        } },
        { externalItemId: "item_collab_spawn", externalTurnId: "turn_1", role: "assistant", kind: "subagent", order: 6, text: "Refactor the module", name: "spawnAgent", sourceAt: null, receivedAt },
        { externalItemId: "item_mcp", externalTurnId: "turn_2", role: "assistant", kind: "tool_call", order: 7, text: null, name: "fixture/lookup", sourceAt: null, receivedAt }
      ],
      cursor: null
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/must-not-leak|abcdefghijklmnop/);
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("maps raw tool items (custom tool calls, shell, file changes, images) with call id association and redaction", async () => {
    const responses = await fixture("session-read-tools");
    const child = processFixture((message, send) => {
      if ("id" in message) send({ ...responses.shift()!, id: message.id });
    });
    const adapter = new CodexProviderSessionSyncAdapter(
      launcher(child.process),
      () => receivedAt
    );

    const snapshot = await adapter.readSession({
      providerId: "codex",
      externalSessionId: "thr_read_tools"
    });

    expect(snapshot.items).toEqual([
      { externalItemId: "ctc_snake", externalTurnId: "turn_tools", role: "assistant", kind: "tool_call", order: 0, text: "npm test --token=[REDACTED]", name: "exec", sourceAt: null, receivedAt },
      { externalItemId: "ctco_snake", externalTurnId: "turn_tools", role: "tool", kind: "tool_result", order: 1, text: "ok password=[REDACTED]\nsecond part", name: "exec", sourceAt: null, receivedAt },
      { externalItemId: "ctc_camel", externalTurnId: "turn_tools", role: "assistant", kind: "tool_call", order: 2, text: "rg --token=[REDACTED]", name: "grep", sourceAt: null, receivedAt },
      { externalItemId: "ctco_camel", externalTurnId: "turn_tools", role: "tool", kind: "tool_result", order: 3, text: "found secret=[REDACTED]", name: "grep", sourceAt: null, receivedAt },
      { externalItemId: "lsc_1", externalTurnId: "turn_tools", role: "tool", kind: "tool_result", order: 4, text: "hi password=[REDACTED]", name: "echo hi", sourceAt: null, receivedAt },
      { externalItemId: "exec_fc", externalTurnId: "turn_tools", role: "tool", kind: "tool_result", order: 5, text: "/workspace/a.txt\nline1 secret=[REDACTED]", name: "/workspace/a.txt", sourceAt: null, receivedAt },
      { externalItemId: "img_1", externalTurnId: "turn_tools", role: "assistant", kind: "tool_call", order: 6, text: null, name: "/tmp/out.png", sourceAt: null, receivedAt },
      { externalItemId: "item_future_tool", externalTurnId: "turn_tools", role: "unknown", kind: "unknown", order: 7, text: null, name: null, sourceAt: null, receivedAt }
    ]);
    expect(JSON.stringify(snapshot)).not.toMatch(/abcdefghijklmnop|must-not-be-exposed/);
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("rejects invalid stable response shapes and still closes the client", async () => {    const child = processFixture((message, send) => {
      if (message.method === "initialize") send({ id: message.id, result: {} });
      if (message.method === "thread/list") {
        send({ id: message.id, result: { data: {}, nextCursor: 42 } });
      }
    });

    await expect(new CodexProviderSessionSyncAdapter(launcher(child.process)).listSessions({
      providerId: "codex"
    })).rejects.toMatchObject({
      name: "ProviderSessionSyncError",
      details: {
        code: "PROTOCOL_INCOMPATIBLE",
        providerId: "codex",
        externalSessionId: null,
        retryable: false
      }
    });
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("reports unverified snapshot capabilities and explicitly rejects unsupported operations", async () => {
    const child = processFixture(() => undefined);
    const adapter = new CodexProviderSessionSyncAdapter(launcher(child.process));

    expect(await adapter.capabilities()).toEqual({
      schemaVersion: 1,
      providerId: "codex",
      listSessions: { state: "compatible_unverified", reason: "codex_session_sync_poc_required", action: "Run the Codex session synchronization POC" },
      readSession: { state: "compatible_unverified", reason: "codex_session_sync_poc_required", action: "Run the Codex session synchronization POC" },
      readHistory: { state: "unavailable", reason: "codex_history_pagination_unavailable", action: null },
      subscribe: { state: "unavailable", reason: "codex_external_subscription_unavailable", action: null },
      cursorResume: { state: "unavailable", reason: "codex_cursor_resume_unavailable", action: null },
      attachedControl: { state: "unavailable", reason: "codex_attached_control_unavailable", action: null }
    });
    await expect(adapter.readHistory({
      ref: { providerId: "codex", externalSessionId: "thr" }
    })).rejects.toMatchObject({ details: { code: "UNAVAILABLE", retryable: false } });
    const iterator = adapter.subscribe({
      ref: { providerId: "codex", externalSessionId: "thr" }
    })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({
      details: { code: "UNAVAILABLE", retryable: false }
    });
    await expect(adapter.readSession({
      providerId: "opencode",
      externalSessionId: "ses"
    })).rejects.toMatchObject({
      details: {
        code: "PROTOCOL_INCOMPATIBLE",
        providerId: "codex",
        externalSessionId: "ses",
        retryable: false
      }
    });
    expect(child.received).toEqual([]);
    expect(child.killed).toEqual([]);
  });

  it("translates an identifiable remote missing thread into a provider-neutral failure", async () => {
    const child = processFixture((message, send) => {
      if (message.method === "initialize") send({ id: message.id, result: {} });
      if (message.method === "thread/read") {
        send({ id: message.id, error: { code: -32000, message: "thread not found" } });
      }
    });
    const adapter = new CodexProviderSessionSyncAdapter(launcher(child.process));

    await expect(adapter.readSession({
      providerId: "codex",
      externalSessionId: "missing/opaque"
    })).rejects.toMatchObject({
      name: "ProviderSessionSyncError",
      details: {
        code: "NOT_FOUND",
        providerId: "codex",
        externalSessionId: "missing/opaque",
        retryable: false
      }
    });
  });
});
