import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./src/create-app.js";

describe("GET /health", () => {
  it("reports SQLite ready and the deferred runtimes explicitly disabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-health-"));
    const app = await createApp({
      databaseFile: join(directory, "nodra.db"),
      migrationsDirectory: resolve("packages/adapters/drizzle")
    });

    try {
      const response = await request(app.getHttpServer()).get("/health").expect(200);
      expect(response.body).toEqual({
        service: "nodra",
        status: "ok",
        components: {
          sqlite: { status: "ok" },
          workflow: {
            status: "disabled",
            detail: "Temporal runtime is deliberately absent from this increment"
          },
          providers: {
            status: "disabled",
            detail: "Provider runtimes are deliberately absent from this increment"
          }
        }
      });
    } finally {
      await app.close();
    }
  });
});
