import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderSessionControlPort, ProviderSessionSyncPort } from "@nodra/application";
import { NodraSqliteDatabase, SqliteProviderCatalogRepository, migrateDatabase } from "@nodra/adapters";
import { createApp } from "./src/create-app.js";

const capabilities = {
  schemaVersion: 1 as const,
  providerId: "codex",
  listSessions: { state: "compatible_unverified" as const, reason: "poc_required", action: "Run POC" },
  readSession: { state: "compatible_unverified" as const, reason: "poc_required", action: "Run POC" },
  readHistory: { state: "unavailable" as const, reason: "unavailable", action: null },
  subscribe: { state: "unavailable" as const, reason: "unavailable", action: null },
  cursorResume: { state: "unavailable" as const, reason: "unavailable", action: null },
  attachedControl: { state: "unavailable" as const, reason: "unavailable", action: null }
};

class FakeProviderSessionSync implements ProviderSessionSyncPort {
  readonly providerId = "codex";
  constructor(readonly cwd: string) {}
  lastListQuery: { providerId: string; cursor?: string | null; limit?: number } | null = null;
  async capabilities() { return capabilities; }
  async listSessions(query: { providerId: string; cursor?: string | null; limit?: number }) {
    this.lastListQuery = query;
    if (query.providerId !== "codex") throw new Error("unexpected provider");
    return {
      sessions: ["thread-1", "thread-2"].slice(0, query.limit).map((externalSessionId) => ({
        ref: { providerId: "codex", externalSessionId },
        title: "Provider title", cwd: this.cwd, state: "idle" as const,
        sourceCreatedAt: "2026-08-01T10:00:00.000Z", sourceUpdatedAt: "2026-08-01T10:01:00.000Z",
        receivedAt: "2026-08-01T10:02:00.000Z"
      })),
      nextCursor: "opaque-next"
    };
  }
  async readSession(ref: { providerId: string; externalSessionId: string }) {
    if (ref.providerId !== "codex" || !["thread-1", "thread-2"].includes(ref.externalSessionId)) throw new Error("missing");
    return {
      session: {
        ref, title: "Provider title", cwd: this.cwd, state: "idle" as const,
        sourceCreatedAt: "2026-08-01T10:00:00.000Z", sourceUpdatedAt: "2026-08-01T10:01:00.000Z",
        receivedAt: "2026-08-01T10:03:00.000Z"
      },
      turns: [], items: [{ externalItemId: "item/user-1", externalTurnId: "turn-1", order: 1, role: "user" as const, kind: "message" as const, text: "  Reproduce the session bug  ", name: null, sourceAt: null, receivedAt: "2026-08-01T10:03:00.000Z" }], cursor: null
    };
  }
  async readHistory(): Promise<never> { throw new Error("not used"); }
  subscribe(): AsyncIterable<never> { throw new Error("not used"); }
}

class FakeProviderSessionControl implements ProviderSessionControlPort {
  readonly providerId = "codex";
  startAvailable = true;
  readonly starts: Array<{ externalSessionId: string; text: string; clientCommandId: string }> = [];
  readonly steers: Array<{ externalSessionId: string; externalTurnId: string; text: string; clientCommandId: string }> = [];
  async capabilities() {
    const available = { state: "certified" as const, reason: null, action: null };
    return {
      schemaVersion: 1 as const, providerId: "codex", read: available,
      startTurn: this.startAvailable ? available : { state: "unavailable" as const, reason: "disabled", action: null },
      steer: available, queue: { state: "unavailable" as const, reason: "no_local_queue", action: null }
    };
  }
  async startTurn(input: { ref: { providerId: string; externalSessionId: string }; text: string; clientCommandId: string }) {
    this.starts.push({ externalSessionId: input.ref.externalSessionId, text: input.text, clientCommandId: input.clientCommandId });
    return { ref: input.ref, externalTurnId: "turn-started" };
  }
  async steer(input: { ref: { providerId: string; externalSessionId: string }; externalTurnId: string; text: string; clientCommandId: string }) {
    this.steers.push({ externalSessionId: input.ref.externalSessionId, externalTurnId: input.externalTurnId, text: input.text, clientCommandId: input.clientCommandId });
    return { ref: input.ref, externalTurnId: input.externalTurnId };
  }
}

describe("I14 provider session snapshot API", () => {
  let app: NestExpressApplication;
  let provider: FakeProviderSessionSync;
  let control: FakeProviderSessionControl;
  let databaseFile: string;

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-i14-api-"));
    const sessionCwd = join(directory, "repository", "subdir");
    await mkdir(sessionCwd, { recursive: true });
    databaseFile = join(directory, "nodra.db");
    const seed = NodraSqliteDatabase.open(databaseFile);
    await migrateDatabase(seed, resolve("packages/adapters/drizzle"));
    const available = { available: true, reason: null };
    await new SqliteProviderCatalogRepository(seed).save({
      providerId: "codex", adapterVersion: "fixture", binaryVersion: null, authenticated: true, authKind: "fixture",
      health: { status: "ready", reason: null, actionRequired: null },
      models: [{ id: "gpt-test", displayName: "GPT test", description: "", hidden: false, isDefault: true, supportedReasoningEfforts: ["medium", "provider_default"], defaultReasoningEffort: "medium" }],
      capabilities: { schemaVersion: 1, providerId: "codex", version: "fixture", availability: available, authentication: available, models: available, contract: { ...available, status: "certified", expectedVersion: "fixture", currentVersion: "fixture", action: null }, start: available, events: available, cancel: available, resume: available, steer: { ...available, mode: "immediate" }, usage: { available: false, reason: "not used", kind: "none" }, attachments: { available: false, reason: "not used" }, mcp: { available: false, reason: "not used" }, permissionInterception: available, optionsSchemaVersion: 1 },
      probedAt: "2026-08-01T10:00:00.000Z"
    });
    seed.close();
    app = await createApp({
      databaseFile,
      migrationsDirectory: resolve("packages/adapters/drizzle"),
      dataRoot: directory,
      temporalAddress: "127.0.0.1:1",
      providerSessionSyncPorts: [provider = new FakeProviderSessionSync(sessionCwd)],
      providerSessionControlPorts: [control = new FakeProviderSessionControl()]
    });
  });

  afterEach(async () => app.close());

  it("reads capabilities and a provider-backed opaque page", async () => {
    await request(app.getHttpServer())
      .get("/api/provider-sessions/capabilities?providerId=codex")
      .expect(200, capabilities);
    await request(app.getHttpServer())
      .get("/api/provider-sessions/capabilities?providerId=missing")
      .expect(404)
      .expect(({ body }) => expect(body).toMatchObject({ code: "PROVIDER_SESSION_SYNC_PROVIDER_NOT_FOUND" }));

    const listed = await request(app.getHttpServer())
      .get("/api/provider-sessions?providerId=codex&limit=1&cursor=opaque-input")
      .expect(200);
    expect(listed.body).toMatchObject({
      nextCursor: "opaque-next",
      sessions: [{
        id: expect.any(String),
        summary: { ref: { providerId: "codex", externalSessionId: "thread-1" }, title: "Provider title" },
        link: null
      }]
    });
    expect(provider.lastListQuery).toMatchObject({ limit: 1, cursor: "opaque-input" });
    await request(app.getHttpServer())
      .get("/api/provider-sessions?providerId=missing")
      .expect(404)
      .expect(({ body }) => expect(body).toMatchObject({ code: "PROVIDER_SESSION_SYNC_PROVIDER_NOT_FOUND" }));
    await request(app.getHttpServer()).get("/api/provider-sessions?providerId=codex&limit=101").expect(400);
  });

  it("shows, refreshes, attaches, and creates a READY agent mission from the current Codex snapshot without launching it", async () => {
    const listed = await request(app.getHttpServer()).get("/api/provider-sessions?providerId=codex").expect(200);
    const id = listed.body.sessions[0].id as string;
    const detail = await request(app.getHttpServer()).get(`/api/provider-sessions/${id}`).expect(200);
    expect(detail.body).toMatchObject({ identity: { id, providerId: "codex" }, snapshot: { session: { title: "Provider title" } }, link: null, capabilities });
    await request(app.getHttpServer()).post(`/api/provider-sessions/${id}/refresh`).send({}).expect(200);

    const mission = await request(app.getHttpServer()).post("/api/missions").send({ title: "Existing" }).expect(201);
    const attached = await request(app.getHttpServer())
      .post(`/api/provider-sessions/${id}/attach`)
      .send({ missionId: mission.body.id, commandId: "attach-1", mode: "read_only" })
      .expect(200);
    expect(attached.body).toMatchObject({ link: { missionId: mission.body.id, mode: "read_only" } });
    await request(app.getHttpServer())
      .post(`/api/provider-sessions/${id}/attach`)
      .send({ missionId: mission.body.id, mode: "read_only" })
      .expect(400);

    const secondId = listed.body.sessions[1].id as string;
    const created = await request(app.getHttpServer())
      .post(`/api/provider-sessions/${secondId}/missions`)
      .send({ title: "Attached mission", commandId: "create-1", mode: "read_only" })
      .expect(201);
    expect(created.body).toMatchObject({
      mission: { id: "mission/provider-session/create-1", title: "Attached mission", executionKind: "agent", state: "READY" },
      link: { mode: "read_only" },
      config: { providerId: "codex", modelId: "gpt-test", reasoningEffort: "medium", missionPrompt: "Reproduce the session bug", permissionPreset: "workspace", providerOptions: { schemaVersion: 1, value: {} }, autoCommitAuthorized: false, integrationTargetRef: null },
      workspace: { kind: "repo", state: "ready", path: expect.stringMatching(/repository\/subdir$/) }
    });
    await request(app.getHttpServer())
      .post(`/api/provider-sessions/${secondId}/missions`)
      .send({ title: "Attached mission", commandId: "create-2", mode: "workspace", missionId: "forbidden" })
      .expect(400);
  });

  it("activates and controls an attached provider thread through mission endpoints without a run, conversation, Temporal, queue, or canonical messages", async () => {
    const listed = await request(app.getHttpServer()).get("/api/provider-sessions?providerId=codex").expect(200);
    const sessionId = listed.body.sessions[0].id as string;
    const created = await request(app.getHttpServer())
      .post(`/api/provider-sessions/${sessionId}/missions`)
      .send({ title: "Provider control", commandId: "create-control", mode: "read_only" })
      .expect(201);
    const missionId = created.body.mission.id as string;
    const missionPathId = encodeURIComponent(missionId);

    await request(app.getHttpServer()).post(`/api/missions/${missionPathId}/start`)
      .send({ expectedVersion: 1, commandId: "legacy-start" }).expect(409)
      .expect(({ body }) => expect(body).toMatchObject({ code: "PROVIDER_SESSION_START_REQUIRED" }));
    await request(app.getHttpServer()).post(`/api/agent-sessions/missions/${missionPathId}/start`)
      .send({ expectedVersion: 1, commandId: "legacy-agent-session-start" }).expect(409)
      .expect(({ body }) => expect(body).toMatchObject({ code: "PROVIDER_SESSION_START_REQUIRED" }));

    await request(app.getHttpServer()).post(`/api/missions/${missionPathId}/provider-session/turns`)
      .send({ text: "forbidden before activation", commandId: "turn-before-active" })
      .expect(403).expect(({ body }) => expect(body).toMatchObject({ code: "PROVIDER_SESSION_CONTROL_FORBIDDEN" }));
    const read = await request(app.getHttpServer()).get(`/api/missions/${missionPathId}/provider-session`).expect(200);
    expect(read.body).toMatchObject({ identity: { externalSessionRef: "thread-1" }, link: { mode: "read_only" }, snapshot: { session: { ref: { externalSessionId: "thread-1" } } } });
    await request(app.getHttpServer()).get(`/api/missions/${missionPathId}/provider-session/capabilities`).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ identity: { externalSessionRef: "thread-1" }, capabilities: { startTurn: { state: "certified" }, steer: { state: "certified" }, queue: { state: "unavailable" } } }));

    control.startAvailable = false;
    await request(app.getHttpServer()).post(`/api/missions/${missionPathId}/provider-session/activate`)
      .send({ expectedVersion: 1, commandId: "activate-without-capability" }).expect(422)
      .expect(({ body }) => expect(body).toMatchObject({ code: "CAPABILITY_UNAVAILABLE" }));
    control.startAvailable = true;
    const activated = await request(app.getHttpServer()).post(`/api/missions/${missionPathId}/provider-session/activate`)
      .send({ expectedVersion: 1, commandId: "activate-control" }).expect(201);
    expect(activated.body).toMatchObject({ mission: { state: "ACTIVE", version: 2 }, link: { mode: "control" }, session: { externalSessionRef: "thread-1" } });
    await request(app.getHttpServer()).post(`/api/missions/${missionPathId}/provider-session/turns`)
      .send({ text: "  Continue externally  ", commandId: "turn-control" }).expect(202)
      .expect({ ref: { providerId: "codex", externalSessionId: "thread-1" }, externalTurnId: "turn-started" });
    await request(app.getHttpServer()).post(`/api/missions/${missionPathId}/provider-session/steer`)
      .send({ externalTurnId: "turn-started", text: "  Focus tests  ", commandId: "steer-control" }).expect(202)
      .expect({ ref: { providerId: "codex", externalSessionId: "thread-1" }, externalTurnId: "turn-started" });
    expect(control.starts).toEqual([{ externalSessionId: "thread-1", text: "Continue externally", clientCommandId: "turn-control" }]);
    expect(control.steers).toEqual([{ externalSessionId: "thread-1", externalTurnId: "turn-started", text: "Focus tests", clientCommandId: "steer-control" }]);

    const verification = NodraSqliteDatabase.open(databaseFile);
    for (const table of ["run", "conversation", "conversation_item", "conversation_queue", "provider_event"] as const) {
      expect(verification.connection.prepare(`select count(*) as count from ${table}`).get(), table).toEqual({ count: 0 });
    }
    verification.close();
  });
});
