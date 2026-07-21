import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./src/create-app.js";

describe("mission and Relay API", () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-api-mission-"));
    app = await createApp({
      databaseFile: join(directory, "nodra.db"),
      migrationsDirectory: resolve("packages/adapters/drizzle")
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

    const list = await request(app.getHttpServer()).get("/api/missions").expect(200);
    expect(list.body).toEqual([expect.objectContaining({ id, state: "DONE", version: 5 })]);
    const shown = await request(app.getHttpServer()).get(`/api/missions/${id}`).expect(200);
    expect(shown.body).toMatchObject({ id, state: "DONE", version: 5 });
    const relay = await request(app.getHttpServer()).get("/api/relay").expect(200);
    expect(relay.body).toEqual({ ready: [], active: [], blocked: [], decision_required: [] });
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
});
