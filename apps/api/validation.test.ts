import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./src/create-app.js";

describe("HTTP DTO validation", () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-api-validation-"));
    app = await createApp({
      databaseFile: join(directory, "nodra.db"),
      migrationsDirectory: resolve("packages/adapters/drizzle"),
      temporalAddress: "127.0.0.1:1"
    });
  });

  afterEach(async () => app.close());

  it("rejects unknown fields with a stable correlated problem", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/missions")
      .send({ title: "valid", unexpected: true, commandId: "dto-unknown" })
      .expect(400);

    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(Object.keys(response.body).sort()).toEqual(["code", "commandId", "detail", "status", "title", "type"]);
    expect(response.body).toMatchObject({
      type: "https://nodra.local/problems/request_invalid",
      title: "REQUEST_INVALID",
      status: 400,
      code: "REQUEST_INVALID",
      commandId: "dto-unknown"
    });
  });

  it("rejects invalid types and enums before application execution", async () => {
    const invalidType = await request(app.getHttpServer())
      .post("/api/missions/mission/start")
      .send({ expectedVersion: "1", commandId: "dto-type" })
      .expect(400);
    expect(invalidType.body).toMatchObject({ code: "REQUEST_INVALID", commandId: "dto-type" });

    const invalidEnum = await request(app.getHttpServer())
      .post("/api/approvals")
      .send({ subjectType: "workspace", subjectId: "id", kind: "review", commandId: "dto-enum" })
      .expect(400);
    expect(invalidEnum.body).toMatchObject({ code: "REQUEST_INVALID", commandId: "dto-enum" });
  });

  it("accepts declared optional fields when omitted", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/missions")
      .send({ title: "optional fields omitted" })
      .expect(201);
    expect(response.body).toMatchObject({ title: "optional fields omitted", projectId: null });
  });
});
