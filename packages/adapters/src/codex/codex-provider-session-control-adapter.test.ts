import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { CodexProcessLauncher } from "./codex-process-launcher.js";
import { CodexProviderSessionControlAdapter } from "./codex-provider-session-control-adapter.js";

type Message = Record<string, unknown>;

const processFixture = (respond: (message: Message) => unknown) => {
  const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough();
  const emitter = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill(signal?: string): boolean };
  const received: Message[] = []; let buffer = "";
  stdin.on("data", (chunk) => {
    buffer += chunk.toString();
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n"); const message = JSON.parse(buffer.slice(0, index)) as Message;
      buffer = buffer.slice(index + 1); received.push(message);
      if ("id" in message) stdout.write(`${JSON.stringify({ id: message.id, result: respond(message) })}\n`);
    }
  });
  emitter.stdin = stdin; emitter.stdout = stdout; emitter.stderr = stderr;
  emitter.kill = () => true;
  return { process: emitter as unknown as ChildProcessWithoutNullStreams, received };
};

const launcher = (process: ChildProcessWithoutNullStreams): CodexProcessLauncher => ({ launch: () => process });

describe("CodexProviderSessionControlAdapter", () => {
  it("starts a turn on the exact provider thread without creating or resuming a thread", async () => {
    const child = processFixture((message) => message.method === "turn/start" ? { turn: { id: "turn-new" } } : {});
    const result = await new CodexProviderSessionControlAdapter(launcher(child.process)).startTurn({
      ref: { providerId: "codex", externalSessionId: "thread-real" },
      clientCommandId: "command-start", text: "Continue the investigation"
    });

    expect(child.received.at(-1)).toEqual({
      method: "turn/start", id: 2,
      params: { threadId: "thread-real", clientUserMessageId: "command-start", input: [{ type: "text", text: "Continue the investigation" }] }
    });
    expect(child.received.some(({ method }) => method === "thread/start" || method === "thread/resume")).toBe(false);
    expect(result).toEqual({ ref: { providerId: "codex", externalSessionId: "thread-real" }, externalTurnId: "turn-new" });
  });

  it("steers the exact active turn and exposes no local queue capability", async () => {
    const child = processFixture((message) => message.method === "turn/steer" ? { turnId: "turn-active" } : {});
    const adapter = new CodexProviderSessionControlAdapter(launcher(child.process));
    expect(await adapter.capabilities()).toMatchObject({
      providerId: "codex", read: { state: "compatible_unverified" }, startTurn: { state: "compatible_unverified" },
      steer: { state: "compatible_unverified" }, queue: { state: "unavailable" }
    });
    await expect(adapter.steer({
      ref: { providerId: "codex", externalSessionId: "thread-real" }, externalTurnId: "turn-active",
      clientCommandId: "command-steer", text: "Focus on the failing test"
    })).resolves.toEqual({ ref: { providerId: "codex", externalSessionId: "thread-real" }, externalTurnId: "turn-active" });
    expect(child.received.at(-1)).toEqual({
      method: "turn/steer", id: 2,
      params: { threadId: "thread-real", expectedTurnId: "turn-active", clientUserMessageId: "command-steer", input: [{ type: "text", text: "Focus on the failing test" }] }
    });
  });

  it("rejects a mismatched provider reference before launching Codex", async () => {
    const child = processFixture(() => ({}));
    await expect(new CodexProviderSessionControlAdapter(launcher(child.process)).startTurn({
      ref: { providerId: "opencode", externalSessionId: "thread" }, clientCommandId: "command", text: "hello"
    })).rejects.toMatchObject({ details: { code: "PROTOCOL_INCOMPATIBLE", providerId: "codex", externalSessionId: "thread" } });
    expect(child.received).toEqual([]);
  });
});
