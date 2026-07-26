import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  migrateDatabase,
  NodraSqliteDatabase,
  SqliteProviderCatalogRepository
} from "@nodra/adapters";
import { createApp } from "./src/create-app.js";
import { outbox } from "../../packages/adapters/src/sqlite/schema/operations.js";
import { runs } from "../../packages/adapters/src/sqlite/schema/runs.js";
import { workspaces } from "../../packages/adapters/src/sqlite/schema/core.js";
import { missionAgentConfigs, missions } from "../../packages/adapters/src/sqlite/schema/missions.js";
import { DeterministicProvider } from "../../poc/temporal/deterministic-provider.js";
import { saveDeterministicCatalog } from "../../poc/temporal/poc-fixture.js";

describe("I7 agent mission configuration API", () => {
  let directory: string;
  let databaseFile: string;
  let app: Awaited<ReturnType<typeof createApp>>;
  const migrationsDirectory = resolve("packages/adapters/drizzle");

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "nodra-i7-api-"));
    databaseFile = join(directory, "nodra.db");
    app = await createApp({
      databaseFile,
      migrationsDirectory,
      temporalAddress: "127.0.0.1:1",
      dataRoot: directory
    });
  });

  afterEach(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps title-only missions human and refuses agent operations before explicit enable", async () => {
    const created = await request(app.getHttpServer()).post("/api/missions")
      .send({ title: "Human by default", commandId: "i7-human-create" }).expect(201);
    expect(created.body).toMatchObject({ executionKind: "human", state: "DRAFT", version: 0 });
    await request(app.getHttpServer()).get(`/api/missions/${created.body.id}/agent-config`).expect(422);
    await request(app.getHttpServer()).post(`/api/missions/${created.body.id}/agent-config/preview`)
      .send({}).expect(422);
    const refused = await request(app.getHttpServer()).post(`/api/missions/${created.body.id}/start`)
      .send({ expectedVersion: 0, commandId: "i7-human-start" }).expect(409);
    expect(refused.body.code).toBe("TRANSITION_FORBIDDEN");
    const database = NodraSqliteDatabase.open(databaseFile);
    expect(database.orm.select().from(runs).all()).toHaveLength(0);
    expect(database.orm.select().from(outbox).where(eq(outbox.kind, "workflow.mission.start")).all())
      .toHaveLength(0);
    database.close();
  });

  it("enables atomically, previews missing catalog without I/O, and refuses READY", async () => {
    const created = await request(app.getHttpServer()).post("/api/missions")
      .send({ title: "Enable me", commandId: "i7-enable-create" }).expect(201);
    const enabled = await request(app.getHttpServer())
      .post(`/api/missions/${created.body.id}/agent-config/enable`)
      .send({ expectedVersion: 0, commandId: "i7-enable" }).expect(201);
    expect(enabled.body).toMatchObject({
      missionId: created.body.id,
      version: 0,
      providerId: null,
      missionPrompt: ""
    });
    const database = NodraSqliteDatabase.open(databaseFile);
    database.orm.insert(workspaces).values({
      id: "i7-missing-catalog-workspace",
      projectId: null,
      kind: "scratch",
      path: join(directory, "missing-catalog"),
      state: "ready",
      createdAt: new Date().toISOString()
    }).run();
    database.close();
    await request(app.getHttpServer()).put(`/api/missions/${created.body.id}/agent-config`)
      .set("If-Match", "\"0\"")
      .send({
        providerId: "never-probed",
        modelId: "missing",
        reasoningEffort: "low",
        providerOptions: { schemaVersion: 1, value: {} },
        missionPrompt: "No hidden provider call",
        permissionPreset: "read_only",
        workspaceId: "i7-missing-catalog-workspace",
        autoCommitAuthorized: false,
        commandId: "i7-missing-catalog-config"
      }).expect(200);
    const preview = await request(app.getHttpServer())
      .post(`/api/missions/${created.body.id}/agent-config/preview`).send({}).expect(201);
    expect(preview.body).toMatchObject({
      resolved: null,
      capabilities: null,
      blockingErrors: [expect.objectContaining({
        code: "CAPABILITY_UNAVAILABLE",
        field: "providerId"
      })]
    });
    const after = NodraSqliteDatabase.open(databaseFile);
    expect(after.orm.select().from(runs).all()).toHaveLength(0);
    expect(after.orm.select().from(outbox).where(eq(outbox.kind, "workflow.mission.start")).all())
      .toHaveLength(0);
    after.close();
    const ready = await request(app.getHttpServer()).post(`/api/missions/${created.body.id}/ready`)
      .send({ expectedVersion: 1, commandId: "i7-invalid-ready" }).expect(422);
    expect(ready.body.code).toBe("CAPABILITY_UNAVAILABLE");
  });

  it("validates model, effort and workspace from the latest snapshot then locks READY config", async () => {
    const provider = new DeterministicProvider();
    const seed = NodraSqliteDatabase.open(databaseFile);
    await migrateDatabase(seed, migrationsDirectory);
    await saveDeterministicCatalog(new SqliteProviderCatalogRepository(seed), provider);
    seed.orm.insert(workspaces).values({
      id: "i7-valid-workspace",
      projectId: null,
      kind: "scratch",
      path: join(directory, "valid"),
      state: "ready",
      createdAt: new Date().toISOString()
    }).run();
    seed.orm.insert(workspaces).values({
      id: "i7-invalid-workspace",
      projectId: null,
      kind: "scratch",
      path: join(directory, "invalid"),
      state: "pending_delete",
      createdAt: new Date().toISOString()
    }).run();
    seed.close();
    const created = await request(app.getHttpServer()).post("/api/missions")
      .send({ title: "Validate snapshot", commandId: "i7-snapshot-create" }).expect(201);
    await request(app.getHttpServer()).post(`/api/missions/${created.body.id}/agent-config/enable`)
      .send({ expectedVersion: 0, commandId: "i7-snapshot-enable" }).expect(201);
    const base = {
      providerId: provider.providerId,
      modelId: "absent-model",
      reasoningEffort: "medium",
      providerOptions: { schemaVersion: 1, value: {} },
      missionPrompt: "Validate only persisted capabilities",
      permissionPreset: "read_only",
      workspaceId: "i7-invalid-workspace",
      autoCommitAuthorized: false
    };
    await request(app.getHttpServer()).put(`/api/missions/${created.body.id}/agent-config`)
      .send({ ...base, expectedVersion: 0, commandId: "i7-invalid-snapshot-config" }).expect(200);
    const invalid = await request(app.getHttpServer())
      .post(`/api/missions/${created.body.id}/agent-config/preview`).send({}).expect(201);
    expect(invalid.body.blockingErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "modelId", code: "CAPABILITY_UNAVAILABLE" }),
      expect.objectContaining({ field: "workspaceId", code: "WORKSPACE_STATE_CONFLICT" })
    ]));
    await request(app.getHttpServer()).put(`/api/missions/${created.body.id}/agent-config`)
      .send({
        ...base,
        expectedVersion: 1,
        modelId: "fixture-model",
        reasoningEffort: "medium",
        workspaceId: "i7-valid-workspace",
        commandId: "i7-invalid-effort-config"
      }).expect(200);
    const invalidEffort = await request(app.getHttpServer())
      .post(`/api/missions/${created.body.id}/agent-config/preview`).send({}).expect(201);
    expect(invalidEffort.body.blockingErrors).toEqual([
      expect.objectContaining({ field: "reasoningEffort", code: "CAPABILITY_UNAVAILABLE" })
    ]);
    await request(app.getHttpServer()).put(`/api/missions/${created.body.id}/agent-config`)
      .send({
        ...base,
        expectedVersion: 2,
        modelId: "fixture-model",
        reasoningEffort: "low",
        workspaceId: "i7-valid-workspace",
        commandId: "i7-valid-config"
      }).expect(200);
    const preview = await request(app.getHttpServer())
      .post(`/api/missions/${created.body.id}/agent-config/preview`).send({}).expect(201);
    expect(preview.body).toMatchObject({
      blockingErrors: [],
      resolved: {
        providerId: provider.providerId,
        modelId: "fixture-model",
        reasoningEffort: "low",
        cwd: join(directory, "valid")
      }
    });
    const ready = await request(app.getHttpServer()).post(`/api/missions/${created.body.id}/ready`)
      .send({ expectedVersion: 1, commandId: "i7-valid-ready" }).expect(201);
    expect(ready.body.state).toBe("READY");
    const locked = await request(app.getHttpServer()).put(`/api/missions/${created.body.id}/agent-config`)
      .send({ ...base, expectedVersion: 3, commandId: "i7-locked" }).expect(409);
    expect(locked.body.code).toBe("AGENT_CONFIG_LOCKED");
    const temporalAbsent = await request(app.getHttpServer()).post(`/api/missions/${created.body.id}/start`)
      .send({ expectedVersion: ready.body.version, commandId: "i7-temporal-absent" }).expect(503);
    expect(temporalAbsent.body.code).toBe("RUNTIME_UNHEALTHY");
    const verify = NodraSqliteDatabase.open(databaseFile);
    expect(verify.orm.select().from(missions).where(eq(missions.id, created.body.id)).get())
      .toMatchObject({ state: "READY" });
    expect(verify.orm.select().from(missionAgentConfigs).where(eq(missionAgentConfigs.missionId, created.body.id)).get())
      .toMatchObject({ version: 3 });
    verify.close();
  });
});
