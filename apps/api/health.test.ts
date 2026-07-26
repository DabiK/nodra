import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./src/create-app.js";

describe("GET /health", () => {
  it("keeps SQLite readable and reports an unavailable Temporal runtime explicitly", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-health-"));
    const app = await createApp({
      databaseFile: join(directory, "nodra.db"),
      migrationsDirectory: resolve("packages/adapters/drizzle"),
      temporalAddress: "127.0.0.1:1"
    });

    try {
      const response = await request(app.getHttpServer()).get("/health").expect(200);
      expect(response.body).toEqual({
        service: "nodra",
        status: "degraded",
        components: {
          sqlite: { status: "ok" },
          workflow: {
            status: "error",
            detail: "Temporal runtime is unavailable"
          },
          providers: {
            providerId: "codex",
            status: "unconfigured",
            reason: "no_explicit_probe",
            action: null
          }
        }
      });
    } finally {
      await app.close();
    }
  });
});
