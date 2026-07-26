import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { asId } from "@nodra/domain";
import type { ProviderEventInput } from "@nodra/application";
import { OpenCodeProviderAdapter } from "./opencode-provider-adapter.js";

const requiredPaths = {
  "/global/health": { get: {} },
  "/config/providers": { get: {} },
  "/session": { post: {} },
  "/session/{sessionID}/message": { get: {} },
  "/session/{sessionID}/prompt_async": { post: {} },
  "/session/{sessionID}/abort": { post: {} },
  "/session/{sessionID}/permissions/{permissionID}": { post: {} },
  "/event": { get: {} }
};

const session = {
  id: "session-fixture",
  projectID: "project-fixture",
  directory: "/workspace",
  title: "fixture",
  version: "1.18.5",
  time: { created: 1, updated: 1 }
};

const model = {
  id: "gemma3:4b",
  providerID: "local-engine",
  name: "Gemma 3 4B",
  family: "gemma",
  release_date: "2025-01-01",
  attachment: false,
  reasoning: false,
  temperature: true,
  tool_call: false,
  modalities: { input: ["text"], output: ["text"] },
  cost: { input: 0, output: 0 },
  limit: { context: 8192, output: 2048 },
  status: "active",
  options: {},
  headers: {},
  variants: { high: { reasoningEffort: "high" } }
};

describe("OpenCodeProviderAdapter", () => {
  const close: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(close.splice(0).map((stop) => stop()));
  });

  it("omits messageID and variant when using provider_default", async () => {
    const requests: string[] = [];
    const promptBodies: Array<Record<string, unknown>> = [];

    const baseUrl = await fixtureServer(requests, promptBodies);

    await new OpenCodeProviderAdapter({ baseUrl }).execute({
      runId: asId("run-provider-default"),
      providerId: "opencode",
      modelId: "local-engine/gemma3:4b",
      reasoningEffort: "provider_default",
      prompt: "Reply with marker",
      cwd: "/workspace",
      permissionPreset: "read_only",
      capabilityVersion: "fixture",
      contractStatus: "compatible_unverified",
      session: null
    }, {
      session: async () => undefined,
      runRef: async () => undefined,
      event: async () => undefined,
      permission: async () => "denied"
    });

    expect(promptBodies).toHaveLength(1);
    expect(promptBodies[0]).not.toHaveProperty("messageID");
    expect(promptBodies[0]).not.toHaveProperty("variant");
  });


  it("probes health, /doc and provider catalog without creating a session", async () => {
    const requests: string[] = [];
    const baseUrl = await fixtureServer(requests);
    const result = await new OpenCodeProviderAdapter({ baseUrl }).probe();

    expect(result).toMatchObject({
      providerId: "opencode",
      binaryVersion: "1.18.5",
      authenticated: true,
      authKind: "server_managed",
      capabilities: {
        start: { available: true },
        events: { available: true },
        cancel: { available: true },
        steer: { available: false, reason: "opencode_steer_not_certified_i8" }
      }
    });
    expect(result.contractDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.models).toEqual([
      expect.objectContaining({
        id: "local-engine/gemma3:4b",
        defaultReasoningEffort: "provider_default",
        supportedReasoningEfforts: ["provider_default", "high"]
      })
    ]);
    expect(requests).toEqual([
      "GET /global/health",
      "GET /doc",
      "GET /config/providers"
    ]);
  });

  it("maps SSE, persists the assistant result and reaches a provider terminal", async () => {
    const requests: string[] = [];
    const promptBodies: Array<Record<string, unknown>> = [];

    const baseUrl = await fixtureServer(requests, promptBodies);

    const events: ProviderEventInput[] = [];
    const permissions: string[] = [];
    const sessions: string[] = [];
    const refs: string[] = [];
    const result = await new OpenCodeProviderAdapter({ baseUrl }).execute({
      runId: asId("run-opencode"),
      providerId: "opencode",
      modelId: "local-engine/gemma3:4b",
      reasoningEffort: "high",
      prompt: "Reply with marker",
      cwd: "/workspace",
      permissionPreset: "read_only",
      capabilityVersion: "fixture",
      contractStatus: "compatible_unverified",
      session: null
    }, {
      session: async (id) => { sessions.push(id); },
      runRef: async (id) => { refs.push(id); },
      event: async (event) => { events.push(event); },
      permission: async (permission) => {
        permissions.push(String(permission.requestId));
        return "denied";
      }
    });

    expect(result.state).toBe("SUCCEEDED");
    expect(sessions).toEqual(["session-fixture"]);
    expect(refs).toEqual(["session-fixture/run-opencode"]);
    expect(events.map((event) => event.type)).toEqual([
      "provider/executionStarted",
      "opencode/message.part.updated",
      "opencode/permission.updated",
      "opencode/session.idle",
      "provider/assistantMessage",
      "provider/executionCompleted"
    ]);
    expect(events.find((event) => event.type === "provider/assistantMessage")?.assistantMessage)
      .toBe("NODRA_I8_OPENCODE_OK");
    expect(permissions).toEqual(["permission-1"]);
    expect(requests).toContain(
      "POST /session/session-fixture/permissions/permission-1"
    );
    expect(requests).toContain("POST /session/session-fixture/prompt_async");
    expect(requests).toContain("VARIANT high");
    expect(requests).toContain("GET /session/session-fixture/message"); expect(promptBodies).toHaveLength(1);

    expect(promptBodies[0]).toMatchObject({
      model: {
        providerID: "local-engine",
        modelID: "gemma3:4b"
      },
      variant: "high",
      parts: [
        {
          type: "text",
          text: "Reply with marker"
        }
      ]
    });

    expect(promptBodies[0]).not.toHaveProperty("messageID");
  });

  const fixtureServer = async (requests: string[], promptBodies: Array<Record<string, unknown>> = []): Promise<string> => {
    let eventResponse: ServerResponse | undefined;
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      requests.push(`${request.method} ${url.pathname}`);
      if (url.pathname === "/global/health") return json(response, { healthy: true, version: "1.18.5" });
      if (url.pathname === "/doc") {
        return json(response, { openapi: "3.1.0", paths: requiredPaths });
      }
      if (url.pathname === "/config/providers") {
        return json(response, {
          providers: [{
            id: "local-engine",
            name: "Local engine",
            source: "config",
            env: [],
            options: {},
            models: { "gemma3:4b": model }
          }],
          default: { "local-engine": "gemma3:4b" }
        });
      }
      if (url.pathname === "/event") {
        eventResponse = response;
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive"
        });
        return;
      }
      if (url.pathname === "/session" && request.method === "POST") return json(response, session);
      if (
        url.pathname === "/session/session-fixture/prompt_async"
        && request.method === "POST"
      ) {
        const chunks: Buffer[] = [];

        for await (const chunk of request) {
          chunks.push(Buffer.from(chunk));
        }

        const body: unknown = JSON.parse(
          Buffer.concat(chunks).toString("utf8")
        );

        if (!isRecord(body)) {
          response.writeHead(400).end();
          return;
        }

        promptBodies.push(body);

        if (typeof body.variant === "string") {
          requests.push(`VARIANT ${body.variant}`);
        }
        response.writeHead(204).end();
        const send = (value: unknown) => eventResponse?.write(`data: ${JSON.stringify(value)}\n\n`);
        queueMicrotask(() => {
          send({
            type: "session.status",
            properties: { sessionID: session.id, status: { type: "busy" } }
          });
          send({
            type: "message.part.updated",
            properties: {
              part: {
                id: "part-1",
                sessionID: session.id,
                messageID: "assistant-1",
                type: "text",
                text: "NODRA_I8_OPENCODE_OK"
              }
            }
          });
          send({
            type: "permission.updated",
            properties: {
              id: "permission-1",
              type: "bash",
              pattern: "git status",
              sessionID: session.id,
              messageID: "assistant-1",
              title: "Run git status",
              metadata: {},
              time: { created: 1 }
            }
          });
          send({ type: "session.idle", properties: { sessionID: session.id } });
        });
        return;
      }
      if (
        url.pathname === "/session/session-fixture/permissions/permission-1"
        && request.method === "POST"
      ) {
        return json(response, true);
      }
      if (
        url.pathname === "/session/session-fixture/message"
        && request.method === "GET"
      ) {
        return json(response, [{
          info: {
            id: "assistant-1",
            sessionID: session.id,
            role: "assistant",
            time: { created: 1 },
            parentID: "user-1",
            modelID: "gemma3:4b",
            providerID: "local-engine",
            mode: "build",
            agent: "build",
            path: { cwd: "/workspace", root: "/workspace" },
            cost: 0,
            tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
          },
          parts: [{
            id: "part-1",
            sessionID: session.id,
            messageID: "assistant-1",
            type: "text",
            text: "NODRA_I8_OPENCODE_OK"
          }]
        }]);
      }
      response.writeHead(404).end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server address missing");
    close.push(async () => {
      eventResponse?.end();
      server.close();
      await once(server, "close");
    });
    return `http://127.0.0.1:${address.port}`;
  };
});

const json = (response: ServerResponse, value: unknown): void => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
