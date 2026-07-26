import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import {
  SqliteProviderCatalogRepository
} from "@nodra/adapters";
import type { NodraSqliteDatabase } from "@nodra/adapters";
import { NodraModule } from "./src/nodra.module.js";
import { DATABASE } from "./src/tokens.js";

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
        dataRoot: directory,
        temporalAddress: "127.0.0.1:1"
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

    const database = app.get<NodraSqliteDatabase>(DATABASE);
    await new SqliteProviderCatalogRepository(database).save({
      providerId: "codex",
      adapterVersion: "codex-app-server-stdio-v1",
      binaryVersion: "codex_cli_rs/future",
      authenticated: true,
      authKind: "chatgpt",
      health: {
        status: "degraded",
        reason: "codex_binary_version_not_certified",
        actionRequired: "update_required"
      },
      capabilities: {
        availability: { available: true, reason: null },
        authentication: { available: true, reason: null },
        models: { available: true, reason: null },
        contract: {
          status: "compatible_unverified",
          reason: "codex_binary_version_not_certified"
        }
      },
      models: [],
      probedAt: "2026-07-26T10:00:00.000Z"
    } as never);
    const health = await request(app.getHttpServer()).get("/health").expect(200);
    expect(health.body).toMatchObject({
      status: "degraded",
      components: {
        workflow: {
          status: "error",
          detail: "Temporal runtime is unavailable"
        },
        providers: {
          providerId: "codex",
          status: "degraded",
          reason: "codex_binary_version_not_certified",
          action: "update_required"
        }
      }
    });
  });
});
