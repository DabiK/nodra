import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { NodraModule } from "./src/nodra.module.js";

describe("I6 provider API", () => {
  const apps: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("reads unprobed status without launching Codex and requires explicit probe opt-in", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-i6-api-"));
    const module = await Test.createTestingModule({
      imports: [NodraModule.register({
        databaseFile: join(directory, "nodra.db"),
        migrationsDirectory: resolve("packages/adapters/drizzle"),
        dataRoot: directory
      })]
    }).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    }));
    await app.init();
    apps.push(app);

    const status = await request(app.getHttpServer())
      .get("/api/providers/capabilities")
      .expect(200);
    expect(status.body).toEqual({
      providerId: "codex",
      status: "not_probed",
      reason: "Run the explicit opt-in provider probe before starting a mission"
    });
    await request(app.getHttpServer())
      .post("/api/providers/codex/probe")
      .send({ optIn: false })
      .expect(400);
    await request(app.getHttpServer())
      .post("/api/providers/codex/probe")
      .send({})
      .expect(400);
  });
});
