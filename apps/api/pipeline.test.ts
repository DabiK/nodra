import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./src/create-app.js";

describe("pipeline API", () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-api-pipeline-"));
    app = await createApp({
      databaseFile: join(directory, "nodra.db"),
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
});
