import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./src/create-app.js";
import {
  NodraSqliteDatabase,
  SqliteMissionExecutionRepository,
  SqliteMissionRepository,
  SqliteProviderCatalogRepository
} from "@nodra/adapters";
import { StartMission, toId } from "@nodra/application";
import { eq } from "drizzle-orm";
import { workspaces } from "../../packages/adapters/src/sqlite/schema/core.js";
import { missionAgentConfigs, missions } from "../../packages/adapters/src/sqlite/schema/missions.js";
import { outbox } from "../../packages/adapters/src/sqlite/schema/operations.js";
import { runs } from "../../packages/adapters/src/sqlite/schema/runs.js";
import { DeterministicProvider } from "../../poc/temporal/deterministic-provider.js";
import { saveDeterministicCatalog } from "../../poc/temporal/poc-fixture.js";

describe("mission and Relay API", () => {
  let app: NestExpressApplication;
  let databaseFile: string;

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-api-mission-"));
    databaseFile = join(directory, "nodra.db");
    app = await createApp({
      databaseFile,
      migrationsDirectory: resolve("packages/adapters/drizzle"),
      temporalAddress: "127.0.0.1:1"
    });
  });

  afterEach(async () => app.close());

  it("exposes the complete human flow through thin REST commands", async () => {
    const created = await request(app.getHttpServer())
      .post("/api/missions")
      .send({ title: "Human API mission", commandId: "api-create" })
      .expect(201);
    const id = created.body.id as string;
    expect(created.body).toMatchObject({ state: "DRAFT", version: 0, executionKind: "human" });

    await request(app.getHttpServer()).post(`/api/missions/${id}/ready`).send({ expectedVersion: 0 }).expect(201);
    await request(app.getHttpServer()).post(`/api/missions/${id}/pickup`).send({ expectedVersion: 1 }).expect(201);
    await request(app.getHttpServer())
      .post(`/api/missions/${id}/block`)
      .send({ expectedVersion: 2, reason: "Needs a decision" })
      .expect(201);
    const blockedRelay = await request(app.getHttpServer()).get("/api/relay").expect(200);
    expect(blockedRelay.body).toEqual({
      ready: [],
      active: [],
      blocked: [expect.objectContaining({ id, state: "BLOCKED", reasonCode: "Needs a decision" })],
      decision_required: []
    });
    await request(app.getHttpServer()).post(`/api/missions/${id}/unblock`).send({ expectedVersion: 3 }).expect(201);
    await request(app.getHttpServer()).post(`/api/missions/${id}/complete`).send({ expectedVersion: 4 }).expect(201);
    await request(app.getHttpServer()).post(`/api/missions/${id}/reopen-ready`).send({ expectedVersion: 5 }).expect(201);
    await request(app.getHttpServer()).post(`/api/missions/${id}/pickup`).send({ expectedVersion: 6 }).expect(201);
    await request(app.getHttpServer()).post(`/api/missions/${id}/block`).send({ expectedVersion: 7, reason: "Paused again" }).expect(201);
    await request(app.getHttpServer()).post(`/api/missions/${id}/abandon`).send({ expectedVersion: 8 }).expect(201);
    await request(app.getHttpServer()).post(`/api/missions/${id}/reopen-active`).send({ expectedVersion: 9 }).expect(201);

    const list = await request(app.getHttpServer()).get("/api/missions").expect(200);
    expect(list.body).toEqual([expect.objectContaining({ id, state: "ACTIVE", version: 10 })]);
    const shown = await request(app.getHttpServer()).get(`/api/missions/${id}`).expect(200);
    expect(shown.body).toMatchObject({ id, state: "ACTIVE", version: 10 });
    const relay = await request(app.getHttpServer()).get("/api/relay").expect(200);
    expect(relay.body).toEqual({ ready: [], active: [expect.objectContaining({ id, state: "ACTIVE" })], blocked: [], decision_required: [] });
  });

  it("returns normative problem details for forbidden and stale transitions", async () => {
    const created = await request(app.getHttpServer()).post("/api/missions").send({ title: "Errors" }).expect(201);
    const id = created.body.id as string;

    const forbidden = await request(app.getHttpServer())
      .post(`/api/missions/${id}/pickup`)
      .send({ expectedVersion: 0, commandId: "forbidden-command" })
      .expect(409);
    expect(forbidden.headers["content-type"]).toContain("application/problem+json");
    expect(forbidden.body).toMatchObject({
      status: 409,
      code: "TRANSITION_FORBIDDEN",
      commandId: "forbidden-command"
    });

    await request(app.getHttpServer()).post(`/api/missions/${id}/ready`).send({ expectedVersion: 0 }).expect(201);
    const conflict = await request(app.getHttpServer())
      .post(`/api/missions/${id}/complete`)
      .send({ expectedVersion: 0, commandId: "stale-command" })
      .expect(409);
    expect(conflict.body).toMatchObject({ status: 409, code: "MISSION_VERSION_CONFLICT", commandId: "stale-command" });
  });

  it("translates duplicated commands and missing projects to correlated problem details", async () => {
    await request(app.getHttpServer())
      .post("/api/missions")
      .send({ title: "First command", commandId: "review-duplicate" })
      .expect(201);
    const duplicate = await request(app.getHttpServer())
      .post("/api/missions")
      .send({ title: "Second command", commandId: "review-duplicate" })
      .expect(409);
    expect(duplicate.headers["content-type"]).toContain("application/problem+json");
    expect(duplicate.body).toMatchObject({
      status: 409,
      code: "COMMAND_ID_CONFLICT",
      commandId: "review-duplicate"
    });

    const missingProject = await request(app.getHttpServer())
      .post("/api/missions")
      .send({ title: "Missing project", projectId: "project-missing", commandId: "review-project" })
      .expect(404);
    expect(missingProject.headers["content-type"]).toContain("application/problem+json");
    expect(missingProject.body).toMatchObject({
      status: 404,
      code: "PROJECT_NOT_FOUND",
      commandId: "review-project"
    });

    const list = await request(app.getHttpServer()).get("/api/missions").expect(200);
    expect(list.body).toHaveLength(1);
  });

  it("keeps reads available, blocks start, and exposes dispatch/reconcile when Temporal is unavailable", async () => {
    const database = NodraSqliteDatabase.open(databaseFile);
    try {
      await saveDeterministicCatalog(
        new SqliteProviderCatalogRepository(database),
        new DeterministicProvider()
      );
      database.orm.insert(workspaces).values({
        id: "workspace-api-agent",
        projectId: null,
        kind: "scratch",
        path: join(tmpdir(), "workspace-api-agent"),
        state: "ready",
        createdAt: "2026-07-22T12:00:00.000Z"
      }).run();
      database.orm.insert(missions).values({
        id: "api-agent",
        projectId: null,
        title: "API agent",
        executionKind: "agent",
        state: "READY",
        version: 1,
        createdAt: "2026-07-22T12:00:00.000Z",
        updatedAt: "2026-07-22T12:00:00.000Z"
      }).run();
      database.orm.insert(missionAgentConfigs).values({
        missionId: "api-agent",
        providerId: "i6-2-deterministic",
        modelId: "fixture-model",
        reasoningEffort: "low",
        providerOptionsJson: "{}",
        missionPrompt: "No provider",
        permissionPreset: "read_only",
        workspaceId: "workspace-api-agent",
        updatedAt: "2026-07-22T12:00:00.000Z"
      }).run();
    } finally {
      database.close();
    }

    const health = await request(app.getHttpServer()).get("/health").expect(200);
    expect(health.body).toMatchObject({
      status: "degraded",
      components: { sqlite: { status: "ok" }, workflow: { status: "error" } }
    });
    await request(app.getHttpServer()).get("/api/missions/api-agent").expect(200);
    const refused = await request(app.getHttpServer())
      .post("/api/missions/api-agent/start")
      .send({ expectedVersion: 1, commandId: "api-unhealthy-start" })
      .expect(503);
    expect(refused.body).toMatchObject({ code: "RUNTIME_UNHEALTHY", commandId: "api-unhealthy-start" });
    await request(app.getHttpServer()).post("/api/runtime/temporal/reconcile").send({}).expect(200, { items: [] });

    const pending = NodraSqliteDatabase.open(databaseFile);
    try {
      expect(pending.orm.select().from(missions).where(eq(missions.id, "api-agent")).get())
        .toMatchObject({ state: "READY", version: 1 });
      expect(pending.orm.select().from(runs).all()).toHaveLength(0);
      expect(pending.orm.select().from(outbox).where(eq(outbox.kind, "workflow.mission.start")).all()).toHaveLength(0);
      await new StartMission(
        new SqliteMissionRepository(pending),
        new SqliteMissionExecutionRepository(pending),
        { check: async () => ({ status: "ok" }) }
      ).execute({
        missionId: toId("api-agent"),
        expectedVersion: 1,
        runId: toId("run-api-agent"),
        conversationId: toId("conversation-api-agent"),
        auditId: toId("audit-api-dispatch"),
        outboxId: toId("outbox-api-dispatch"),
        context: {
          commandId: toId("api-dispatch"),
          actor: "user",
          occurredAt: "2026-07-22T12:00:00.000Z"
        }
      });
    } finally {
      pending.close();
    }
    const dispatch = await request(app.getHttpServer())
      .post("/api/runtime/temporal/dispatch")
      .send({ limit: 10 })
      .expect(503);
    expect(dispatch.body).toMatchObject({ code: "RUNTIME_UNHEALTHY" });

    const after = NodraSqliteDatabase.open(databaseFile);
    try {
      expect(after.orm.select().from(missions).where(eq(missions.id, "api-agent")).get())
        .toMatchObject({ state: "ACTIVE", version: 2 });
      expect(after.orm.select().from(runs).all()).toHaveLength(1);
      expect(after.orm.select().from(outbox).where(eq(outbox.kind, "workflow.mission.start")).all())
        .toEqual([expect.objectContaining({ id: "outbox-api-dispatch", publishedAt: null })]);
    } finally {
      after.close();
    }
  });
});
