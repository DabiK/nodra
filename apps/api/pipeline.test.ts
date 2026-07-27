import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./src/create-app.js";
import { NodraSqliteDatabase } from "@nodra/adapters";
import { conversations, conversationItems } from "../../packages/adapters/src/sqlite/schema/conversations.js";
import { runs } from "../../packages/adapters/src/sqlite/schema/runs.js";

describe("pipeline API", () => {
  let app: NestExpressApplication;
  let databaseFile: string;

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-api-pipeline-"));
    databaseFile = join(directory, "nodra.db");
    app = await createApp({
      databaseFile,
      migrationsDirectory: resolve("packages/adapters/drizzle"),
      temporalAddress: "127.0.0.1:1"
    });
  });

  afterEach(async () => app.close());

  it("creates, starts and advances a linear human mission pipeline", async () => {
    const first = await request(app.getHttpServer())
      .post("/api/missions")
      .send({ title: "First", commandId: "pipeline-first" })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post("/api/missions")
      .send({ title: "Second", commandId: "pipeline-second" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/missions/${first.body.id}/ready`)
      .send({ expectedVersion: 0 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/missions/${second.body.id}/ready`)
      .send({ expectedVersion: 0 })
      .expect(201);

    const pipeline = await request(app.getHttpServer())
      .post("/api/pipelines")
      .send({
        id: "pipeline-api",
        name: "Pipeline API",
        commandId: "pipeline-create",
        nodes: [
          { nodeKey: "first", missionId: first.body.id },
          { nodeKey: "second", missionId: second.body.id }
        ]
      })
      .expect(201);
    expect(pipeline.body.definition.nodes).toHaveLength(2);

    const started = await request(app.getHttpServer())
      .post("/api/pipelines/pipeline-api/start")
      .send({ runId: "pipeline-run-api", commandId: "pipeline-start" })
      .expect(201);
    expect(started.body.pipelineRun.nodes.map((node: { state: string }) => node.state))
      .toEqual(["ready", "pending"]);

    await request(app.getHttpServer())
      .post(`/api/missions/${first.body.id}/complete`)
      .send({ expectedVersion: 1 })
      .expect(201);
    const advanced = await request(app.getHttpServer())
      .post("/api/pipelines/runs/pipeline-run-api/advance")
      .send({ commandId: "pipeline-advance-first" })
      .expect(201);
    expect(advanced.body.pipelineRun.nodes.map((node: { state: string }) => node.state))
      .toEqual(["completed", "ready"]);

    await request(app.getHttpServer())
      .post(`/api/missions/${second.body.id}/complete`)
      .send({ expectedVersion: 1 })
      .expect(201);
    const completed = await request(app.getHttpServer())
      .post("/api/pipelines/runs/pipeline-run-api/advance")
      .send({ commandId: "pipeline-advance-second" })
      .expect(201);
    expect(completed.body.pipelineRun.state).toBe("completed");
    expect(completed.body.pipelineRun.nodes.map((node: { state: string }) => node.state))
      .toEqual(["completed", "completed"]);

    const shown = await request(app.getHttpServer())
      .get("/api/pipelines/runs/pipeline-run-api")
      .expect(200);
    expect(shown.body.state).toBe("completed");
  });

  it("supports arbitrary join edges", async () => {
    const missionIds: string[] = [];
    for (const name of ["A", "B", "C", "D"]) {
      const created = await request(app.getHttpServer())
        .post("/api/missions")
        .send({ title: `Mission ${name}`, commandId: `join-${name}` })
        .expect(201);
      missionIds.push(created.body.id as string);
      await request(app.getHttpServer())
        .post(`/api/missions/${created.body.id}/ready`)
        .send({ expectedVersion: 0 })
        .expect(201);
    }

    await request(app.getHttpServer())
      .post("/api/pipelines")
      .send({
        id: "pipeline-join-api",
        name: "Pipeline Join API",
        commandId: "pipeline-join-create",
        nodes: [
          { nodeKey: "a", missionId: missionIds[0] },
          { nodeKey: "b", missionId: missionIds[1] },
          { nodeKey: "c", missionId: missionIds[2] },
          { nodeKey: "d", missionId: missionIds[3] }
        ],
        edges: [
          { fromNodeKey: "a", toNodeKey: "d" },
          { fromNodeKey: "b", toNodeKey: "d" },
          { fromNodeKey: "c", toNodeKey: "d" }
        ]
      })
      .expect(201);

    const started = await request(app.getHttpServer())
      .post("/api/pipelines/pipeline-join-api/start")
      .send({ runId: "pipeline-run-join-api" })
      .expect(201);
    expect(started.body.pipelineRun.nodes.map((node: { nodeKey: string; state: string }) => [node.nodeKey, node.state]))
      .toEqual([["a", "ready"], ["b", "ready"], ["c", "ready"], ["d", "pending"]]);

    for (const id of missionIds.slice(0, 3)) {
      await request(app.getHttpServer())
        .post(`/api/missions/${id}/complete`)
        .send({ expectedVersion: 1 })
        .expect(201);
    }
    const advanced = await request(app.getHttpServer())
      .post("/api/pipelines/runs/pipeline-run-join-api/advance")
      .send({})
      .expect(201);
    expect(advanced.body.pipelineRun.nodes.find((node: { nodeKey: string }) => node.nodeKey === "d").state)
      .toBe("ready");
  });

  it("can switch a started transition to human mode and approve it", async () => {
    const first = await request(app.getHttpServer())
      .post("/api/missions")
      .send({ title: "First human gate", commandId: "human-gate-first" })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post("/api/missions")
      .send({ title: "Second human gate", commandId: "human-gate-second" })
      .expect(201);
    await request(app.getHttpServer()).post(`/api/missions/${first.body.id}/ready`).send({ expectedVersion: 0 }).expect(201);
    await request(app.getHttpServer()).post(`/api/missions/${second.body.id}/ready`).send({ expectedVersion: 0 }).expect(201);
    await request(app.getHttpServer())
      .post("/api/pipelines")
      .send({
        id: "pipeline-human-gate-api",
        name: "Pipeline human gate API",
        nodes: [
          { nodeKey: "a", missionId: first.body.id },
          { nodeKey: "b", missionId: second.body.id }
        ]
      })
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/pipelines/pipeline-human-gate-api/start")
      .send({ runId: "pipeline-run-human-gate-api" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/pipelines/runs/pipeline-run-human-gate-api/nodes/b/mode")
      .send({ mode: "human" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/missions/${first.body.id}/complete`)
      .send({ expectedVersion: 1 })
      .expect(201);
    const blocked = await request(app.getHttpServer())
      .post("/api/pipelines/runs/pipeline-run-human-gate-api/advance")
      .send({})
      .expect(201);
    expect(blocked.body.pipelineRun.state).toBe("blocked");
    expect(blocked.body.pipelineRun.nodes.find((node: { nodeKey: string }) => node.nodeKey === "b").state)
      .toBe("pending");

    const approved = await request(app.getHttpServer())
      .post("/api/pipelines/runs/pipeline-run-human-gate-api/nodes/b/approve-transition")
      .send({})
      .expect(201);
    const node = approved.body.pipelineRun.nodes.find((candidate: { nodeKey: string }) => candidate.nodeKey === "b");
    expect(node.state).toBe("ready");
    expect(node.transitionMode).toBe("auto");
    expect(node.handovers).toHaveLength(1);
  });

  it("publishes a node handover from the latest assistant message", async () => {
    const first = await request(app.getHttpServer())
      .post("/api/missions")
      .send({ title: "First handover", commandId: "handover-first" })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post("/api/missions")
      .send({ title: "Second handover", commandId: "handover-second" })
      .expect(201);
    await request(app.getHttpServer()).post(`/api/missions/${first.body.id}/ready`).send({ expectedVersion: 0 }).expect(201);
    await request(app.getHttpServer()).post(`/api/missions/${second.body.id}/ready`).send({ expectedVersion: 0 }).expect(201);
    await request(app.getHttpServer())
      .post("/api/pipelines")
      .send({
        id: "pipeline-handover-api",
        name: "Pipeline handover API",
        nodes: [
          { nodeKey: "a", missionId: first.body.id },
          { nodeKey: "b", missionId: second.body.id }
        ]
      })
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/pipelines/pipeline-handover-api/start")
      .send({ runId: "pipeline-run-handover-api" })
      .expect(201);

    const database = NodraSqliteDatabase.open(databaseFile);
    try {
      database.orm.insert(conversations).values({
        id: "conversation-api-handover",
        missionId: first.body.id,
        managerId: null,
        providerId: "opencode",
        providerSessionRef: null,
        state: "open",
        createdAt: "2026-07-26T21:00:00.000Z",
        deletedAt: null
      }).run();
      database.orm.insert(runs).values({
        id: "run-api-handover",
        missionId: first.body.id,
        managerId: null,
        conversationId: "conversation-api-handover",
        userAttempt: 1,
        state: "SUCCEEDED",
        temporalWorkflowId: "run/run-api-handover",
        temporalRunId: "temporal-run-api-handover",
        providerId: "opencode",
        modelId: "model",
        reasoningEffort: "provider_default",
        createdAt: "2026-07-26T21:00:00.000Z"
      }).run();
      database.orm.insert(conversationItems).values({
        id: "assistant-api-handover",
        conversationId: "conversation-api-handover",
        ordinal: 0,
        kind: "assistant",
        deliveryState: "acknowledged",
        body: "API_HANDOVER_FROM_A",
        providerItemRef: "assistant-api-handover",
        createdAt: "2026-07-26T21:00:00.000Z",
        acknowledgedAt: "2026-07-26T21:00:00.000Z"
      }).run();
    } finally {
      database.close();
    }

    await request(app.getHttpServer())
      .post("/api/pipelines/runs/pipeline-run-handover-api/nodes/a/publish-handover")
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/missions/${first.body.id}/complete`)
      .send({ expectedVersion: 1 })
      .expect(201);
    const advanced = await request(app.getHttpServer())
      .post("/api/pipelines/runs/pipeline-run-handover-api/advance")
      .send({})
      .expect(201);
    expect(advanced.body.pipelineRun.nodes.find((node: { nodeKey: string }) => node.nodeKey === "b").handovers[0].payload.message)
      .toBe("API_HANDOVER_FROM_A");
  });
});
