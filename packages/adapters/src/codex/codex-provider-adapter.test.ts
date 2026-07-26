import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { asId } from "@nodra/domain";
import { describe, expect, it } from "vitest";
import { CodexEventMapper } from "./codex-event-mapper.js";
import { CodexJsonRpcClient } from "./codex-json-rpc-client.js";
import type { CodexProcessLauncher } from "./codex-process-launcher.js";
import { CodexProviderAdapter } from "./codex-provider-adapter.js";

type Message = Record<string, unknown>;

const fixture = async (name: string): Promise<Message[]> => {
  const path = fileURLToPath(new URL(`./fixtures/${name}.jsonl`, import.meta.url));
  return (await readFile(path, "utf8")).trim().split("\n")
    .map((line) => (JSON.parse(line) as { message: Message }).message);
};

const processFixture = (
  receive: (message: Message, send: (message: Message | string) => void) => void
): { process: ChildProcessWithoutNullStreams; received: Message[] } => {
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
  const send = (message: Message | string) => {
    stdout.write(typeof message === "string" ? `${message}\n` : `${JSON.stringify(message)}\n`);
  };
  let buffer = "";
  stdin.on("data", (chunk) => {
    buffer += chunk.toString();
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n");
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      const message = JSON.parse(line) as Message;
      received.push(message);
      receive(message, send);
    }
  });
  emitter.stdin = stdin;
  emitter.stdout = stdout;
  emitter.stderr = stderr;
  emitter.kill = () => {
    queueMicrotask(() => emitter.emit("exit", 0, null));
    return true;
  };
  return { process: emitter as unknown as ChildProcessWithoutNullStreams, received };
};

const launcher = (process: ChildProcessWithoutNullStreams): CodexProcessLauncher => ({
  launch: () => process
});

const configuration = {
  runId: asId("run-1"),
  providerId: "codex",
  modelId: "model-1",
  reasoningEffort: "medium" as const,
  prompt: "work",
  cwd: "/workspace",
  permissionPreset: "workspace" as const,
  capabilityVersion: "codex-app-server-stdio-v1:codex_cli_rs/0.145.0",
  contractStatus: "certified" as const,
  session: null
};

describe("CodexProviderAdapter JSONL fixtures", () => {
  it.runIf(process.env.NODRA_TEST_REAL_CODEX_PROBE === "1")(
    "runs the real no-turn probe only when the dedicated environment opt-in is set",
    async () => {
      const result = await new CodexProviderAdapter().probe();
      expect(result.providerId).toBe("codex");
    }
  );

  it("probes handshake, account and models without creating a thread or turn", async () => {
    const responses = await fixture("probe");
    const child = processFixture((message, send) => {
      if ("id" in message) send(responses.shift()!);
    });
    const result = await new CodexProviderAdapter(launcher(child.process)).probe();

    expect(child.received.map((message) => message.method).filter(Boolean)).toEqual([
      "initialize", "initialized", "account/read", "model/list"
    ]);
    expect(child.received.some((message) => message.method === "thread/start")).toBe(false);
    expect(result).toMatchObject({
      authenticated: true,
      binaryVersion: "codex_cli_rs/0.145.0",
      models: [{ id: "model-1", defaultReasoningEffort: "medium" }]
    });
    expect(result.capabilities.authentication).toEqual({ available: true, reason: null });
    expect(result.capabilities.contract).toEqual({
      available: true,
      reason: null,
      status: "certified",
      expectedVersion: "codex_cli_rs/0.145.0",
      currentVersion: "codex_cli_rs/0.145.0",
      action: null
    });
    expect(result.health).toEqual({
      status: "ready",
      reason: null,
      actionRequired: null
    });
    expect(result.capabilities.attachments).toMatchObject({ available: false });
    expect(result.capabilities.mcp).toMatchObject({ available: false });
    expect(result.capabilities.usage).toEqual({
      available: false,
      reason: "usage_not_observed_by_explicit_probe",
      kind: "none"
    });
    expect(JSON.stringify(result)).not.toContain("not-persisted@example.test");
  });

  it("allows a different probed version as compatible_unverified with an actionable warning", async () => {
    const responses = await fixture("probe");
    responses[0] = {
      ...responses[0],
      result: {
        ...(responses[0]!.result as Record<string, unknown>),
        userAgent: "codex_cli_rs/0.145.0-dev"
      }
    };
    const child = processFixture((message, send) => {
      if ("id" in message) send(responses.shift()!);
    });

    const result = await new CodexProviderAdapter(launcher(child.process)).probe();

    expect(result.capabilities.start).toEqual({ available: true, reason: null });
    expect(result.capabilities.contract).toEqual({
      available: true,
      reason: "codex_binary_version_not_certified",
      status: "compatible_unverified",
      expectedVersion: "codex_cli_rs/0.145.0",
      currentVersion: "codex_cli_rs/0.145.0-dev",
      action: "Run is allowed with a persistent warning; review CONTRACT_UPGRADE.md"
    });
    expect(result.health).toEqual({
      status: "degraded",
      reason: "codex_binary_version_not_certified",
      actionRequired: "update_required"
    });
    expect(child.received.some((message) => message.method === "thread/start")).toBe(false);
  });

  it("distinguishes a missing binary, missing authentication and an empty model catalog", async () => {
    const missingBinary = processFixture(() => undefined);
    const missingProbe = new CodexProviderAdapter(launcher(missingBinary.process)).probe();
    missingBinary.process.emit(
      "error",
      Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" })
    );
    const missing = await missingProbe;
    expect(missing.capabilities.availability).toEqual({
      available: false,
      reason: "codex_binary_not_found"
    });
    expect(missing.capabilities.contract).toMatchObject({
      available: false,
      reason: "protocol_incompatible",
      status: "incompatible",
      expectedVersion: "codex_cli_rs/0.145.0",
      currentVersion: null
    });
    expect(missing.health).toEqual({
      status: "unavailable",
      reason: "codex_binary_not_found",
      actionRequired: "install_or_start_binary"
    });

    const unauthenticated = processFixture((message, send) => {
      if (message.method === "initialize") {
        send({ id: message.id, result: { userAgent: "codex_cli_rs/0.145.0" } });
      } else if (message.method === "account/read") {
        send({ id: message.id, result: { account: null, requiresOpenaiAuth: true } });
      } else if (message.method === "model/list") {
        send({
          id: message.id,
          result: {
            data: [{
              model: "model-1",
              supportedReasoningEfforts: [],
              defaultReasoningEffort: "medium"
            }]
          }
        });
      }
    });
    const unauthenticatedResult = await new CodexProviderAdapter(
      launcher(unauthenticated.process)
    ).probe();
    expect(unauthenticatedResult.capabilities.authentication).toEqual({
      available: false,
      reason: "codex_authentication_required"
    });
    expect(unauthenticatedResult.capabilities.models.available).toBe(true);
    expect(unauthenticatedResult.capabilities.start.reason).toBe(
      "codex_authentication_required"
    );
    expect(unauthenticatedResult.health.actionRequired).toBe("authenticate");

    const emptyCatalog = processFixture((message, send) => {
      if (message.method === "initialize") {
        send({ id: message.id, result: { userAgent: "codex_cli_rs/0.145.0" } });
      } else if (message.method === "account/read") {
        send({
          id: message.id,
          result: { account: { type: "apiKey" }, requiresOpenaiAuth: true }
        });
      } else if (message.method === "model/list") {
        send({ id: message.id, result: { data: [], nextCursor: null } });
      }
    });
    const emptyCatalogResult = await new CodexProviderAdapter(
      launcher(emptyCatalog.process)
    ).probe();
    expect(emptyCatalogResult.capabilities.authentication.available).toBe(true);
    expect(emptyCatalogResult.capabilities.models).toEqual({
      available: false,
      reason: "codex_model_catalog_empty"
    });
    expect(emptyCatalogResult.capabilities.start.reason).toBe(
      "codex_model_catalog_empty"
    );
    expect(emptyCatalogResult.health.actionRequired).toBe("discover_models");
  });

  it("starts with the certified 0.145.0 fields and serializes async notifications in arrival order", async () => {
    const messages = await fixture("turn-success");
    const expectedStart = await fixture("start-config-0.145.0");
    const responses = messages.slice(0, 3);
    const notifications = messages.slice(3);
    const child = processFixture((message, send) => {
      if ("id" in message && "method" in message) {
        send(responses.shift()!);
        if (message.method === "turn/start") queueMicrotask(() => notifications.forEach(send));
      }
    });
    const events: string[] = [];
    const sessions: string[] = [];
    const runRefs: string[] = [];
    const result = await new CodexProviderAdapter(launcher(child.process)).execute(configuration, {
      session: async (id) => { sessions.push(id); },
      runRef: async (id) => { runRefs.push(id); },
      event: async (event) => {
        if (event.type === "turn/started") {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        events.push(event.type);
      },
      permission: async () => ({ scope: "turn", permissions: {} })
    });

    expect(result.state).toBe("SUCCEEDED");
    expect(sessions).toEqual(["thr_fixture"]);
    expect(runRefs).toEqual(["turn_fixture"]);
    expect(events).toEqual(notifications.map((message) => message.method));
    expect(child.received.find((message) => message.method === "thread/start")).toEqual(expectedStart[0]);
    expect(child.received.find((message) => message.method === "turn/start")).toMatchObject({
      params: {
        threadId: "thr_fixture",
        clientUserMessageId: "run-1/prompt",
        input: [{ type: "text", text: "work" }],
        cwd: "/workspace",
        model: "model-1",
        effort: "medium"
      }
    });
    expect(child.received.find((message) => message.method === "turn/start")).toEqual(expectedStart[1]);
  });

  it("runs a compatible_unverified binary and persists the warning before the turn", async () => {
    const child = processFixture((message, send) => {
      if (message.method === "initialize") {
        send({ id: message.id, result: { userAgent: "codex_cli_rs/0.146.0" } });
      } else if (message.method === "thread/start") {
        send({ id: message.id, result: { thread: { id: "thr_future" } } });
      } else if (message.method === "turn/start") {
        send({ id: message.id, result: { turn: { id: "turn_future" } } });
        send({
          method: "turn/completed",
          params: { turn: { id: "turn_future", status: "completed" } }
        });
      }
    });
    const events: string[] = [];

    const result = await new CodexProviderAdapter(launcher(child.process)).execute({
      ...configuration,
      capabilityVersion: "codex-app-server-stdio-v1:codex_cli_rs/0.146.0",
      contractStatus: "compatible_unverified"
    }, {
      session: async () => undefined,
      runRef: async () => undefined,
      event: async (event) => { events.push(event.type); },
      permission: async () => ({})
    });

    expect(result.state).toBe("SUCCEEDED");
    expect(events).toEqual(["provider/contractWarning", "turn/completed"]);
    expect(child.received.some((message) => message.method === "thread/start")).toBe(true);
  });

  it("resumes the persisted thread, steers the active turn and interrupts it", async () => {
    const expectedControl = await fixture("control");
    const child = processFixture((message, send) => {
      if (message.method === "initialize") {
        send({ id: message.id, result: { userAgent: "codex_cli_rs/0.145.0" } });
      } else if (message.method === "thread/resume") {
        send({ id: message.id, result: { thread: { id: "thr_fixture" } } });
      } else if (message.method === "turn/start") {
        send({ id: message.id, result: { turn: { id: "turn_fixture" } } });
        send({ method: "turn/started", params: { turn: { id: "turn_fixture", status: "inProgress" } } });
      } else if (message.method === "turn/steer") {
        send({ id: message.id, result: { turnId: "turn_fixture" } });
      } else if (message.method === "turn/interrupt") {
        send({ id: message.id, result: {} });
        send({ method: "turn/completed", params: { turn: { id: "turn_fixture", status: "interrupted" } } });
      }
    });
    const adapter = new CodexProviderAdapter(launcher(child.process));
    const execution = adapter.execute({
      ...configuration,
      session: { externalId: "thr_fixture" }
    }, {
      session: async () => undefined,
      runRef: async () => undefined,
      event: async () => undefined,
      permission: async () => ({ scope: "turn", permissions: {} })
    });
    await expect.poll(() => child.received.some((message) => message.method === "turn/start")).toBe(true);
    await adapter.steer("run-1", "more");
    await adapter.cancel("run-1");

    await expect(execution).resolves.toMatchObject({ state: "CANCELLED", externalSessionId: "thr_fixture" });
    expect(child.received.find((message) => message.method === "thread/resume"))
      .toEqual(expectedControl[0]);
    expect(child.received.find((message) => message.method === "turn/steer")).toMatchObject({
      method: expectedControl[1]!.method,
      id: expectedControl[1]!.id,
      params: {
        ...(expectedControl[1]!.params as Record<string, unknown>),
        clientUserMessageId: expect.stringMatching(/^run-1\/steer\/\d+$/)
      }
    });
    expect(child.received.find((message) => message.method === "turn/interrupt"))
      .toEqual(expectedControl[2]);
  });

  it("does not answer a provider permission request before the Nodra decision resolves", async () => {
    const permissionMessages = await fixture("permission");
    let resolvePermission!: (value: unknown) => void;
    const permissionDecision = new Promise((resolve) => { resolvePermission = resolve; });
    const child = processFixture((message, send) => {
      if (message.method === "initialize") send({ id: message.id, result: { userAgent: "codex_cli_rs/0.145.0" } });
      if (message.method === "thread/start") send({ id: message.id, result: { thread: { id: "thr_fixture" } } });
      if (message.method === "turn/start") {
        send({ id: message.id, result: { turn: { id: "turn_fixture" } } });
        send(permissionMessages[0]!);
      }
      if (message.id === 61 && "result" in message) {
        send({ method: "turn/completed", params: { turn: { id: "turn_fixture", status: "completed" } } });
      }
    });
    const execution = new CodexProviderAdapter(launcher(child.process)).execute(configuration, {
      session: async () => undefined,
      runRef: async () => undefined,
      event: async () => undefined,
      permission: async () => permissionDecision
    });
    await expect.poll(() => child.received.some((message) => message.method === "turn/start")).toBe(true);
    expect(child.received.some((message) => message.id === 61)).toBe(false);
    resolvePermission((permissionMessages[1]!.result as unknown));
    await execution;
    expect(child.received.find((message) => message.id === 61)).toEqual(permissionMessages[1]);
  });

  it("maps the documented 0.145.0 command and file approval fixtures exactly", async () => {
    const approvals = await fixture("legacy-approvals");
    const requests = [approvals[0]!, approvals[2]!];
    const responses = new Map([
      [62, approvals[1]!.result],
      [63, approvals[3]!.result]
    ]);
    const child = processFixture((message, send) => {
      if (message.method === "initialize") {
        send({ id: message.id, result: { userAgent: "codex_cli_rs/0.145.0" } });
      } else if (message.method === "thread/start") {
        send({ id: message.id, result: { thread: { id: "thr_fixture" } } });
      } else if (message.method === "turn/start") {
        send({ id: message.id, result: { turn: { id: "turn_fixture" } } });
        requests.forEach(send);
      } else if (
        requests.every((request) => child.received.some((received) => received.id === request.id))
      ) {
        send({
          method: "turn/completed",
          params: { turn: { id: "turn_fixture", status: "completed" } }
        });
      }
    });

    await new CodexProviderAdapter(launcher(child.process)).execute(configuration, {
      session: async () => undefined,
      runRef: async () => undefined,
      event: async () => undefined,
      permission: async (request) => responses.get(Number(request.requestId))
    });

    expect(child.received.find((message) => message.id === 62)).toEqual(approvals[1]);
    expect(child.received.find((message) => message.id === 63)).toEqual(approvals[3]);
  });

  it("redacts secret fields and values before provider events leave the adapter", () => {
    const mapped = new CodexEventMapper().map("item/completed", {
      authorization: "Bearer secret-value",
      item: {
        type: "agentMessage",
        text: "token=secret-value and sk-abcdefghijklmnop"
      }
    });

    expect(JSON.stringify(mapped.event.payload)).not.toContain("secret-value");
    expect(JSON.stringify(mapped.event.payload)).not.toContain("sk-abcdefghijklmnop");
    expect(mapped.event.payload).toMatchObject({
      authorization: "[REDACTED]",
      item: {
        text: "token=[REDACTED] and [REDACTED]"
      }
    });
  });

  it("preserves the breaking terminal event then fails with protocol_incompatible", async () => {
    const child = processFixture((message, send) => {
      if (message.method === "initialize") {
        send({ id: message.id, result: { userAgent: "codex_cli_rs/0.145.0" } });
      } else if (message.method === "thread/start") {
        send({ id: message.id, result: { thread: { id: "thr_fixture" } } });
      } else if (message.method === "turn/start") {
        send({ id: message.id, result: { turn: { id: "turn_fixture" } } });
        send({
          method: "turn/completed",
          params: { turn: { id: "turn_fixture", status: "futureTerminalState" } }
        });
      }
    });
    const events: string[] = [];

    await expect(new CodexProviderAdapter(launcher(child.process)).execute(configuration, {
      session: async () => undefined,
      runRef: async () => undefined,
      event: async (event) => { events.push(event.type); },
      permission: async () => ({})
    })).rejects.toMatchObject({ code: "PROVIDER_PROTOCOL_INCOMPATIBLE" });
    expect(events).toEqual(["turn/completed", "provider/protocolIncompatible"]);
  });

  it("surfaces protocol errors, malformed JSONL and process exits", async () => {
    const remote = processFixture((message, send) => {
      if (message.method === "initialize") send({ id: message.id, error: { code: -32600, message: "bad" } });
    });
    await expect(new CodexProviderAdapter(launcher(remote.process)).execute(configuration, {
      session: async () => undefined,
      runRef: async () => undefined,
      event: async () => undefined,
      permission: async () => ({})
    })).rejects.toThrow("Codex app-server -32600");

    const malformed = processFixture((_message, send) => send("{not-json"));
    await expect(new CodexJsonRpcClient(malformed.process).initialize()).rejects.toMatchObject({
      code: "CODEX_PROTOCOL_ERROR"
    });

    const exited = processFixture(() => undefined);
    const client = new CodexJsonRpcClient(exited.process);
    const pending = client.initialize();
    exited.process.emit("exit", 9, null);
    await expect(pending).rejects.toMatchObject({ code: "CODEX_PROCESS_EXIT" });

    const unknown = processFixture((_message, send) => send({ id: 999, result: {} }));
    await expect(new CodexJsonRpcClient(unknown.process).initialize()).rejects.toThrow(
      "unknown response id 999"
    );
  });
});
