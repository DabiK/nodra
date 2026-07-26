import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./src/create-app.js";

describe("I5 workspace API", () => {
  let app: NestExpressApplication;
  let root: string;
  let workspacePath: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "nodra-i5-api-")));
    workspacePath = join(root, "data", "workspaces", "scratch");
    app = await createApp({
      databaseFile: join(root, "nodra.db"),
      migrationsDirectory: resolve("packages/adapters/drizzle"),
      temporalAddress: "127.0.0.1:1",
      dataRoot: join(root, "data")
    });
  });

  afterEach(async () => app.close());

  it("uses exact confirmation for non-destructive tombstone and explicit restore", async () => {
    const created = await request(app.getHttpServer())
      .post("/api/workspaces")
      .send({
        id: "api-scratch",
        kind: "scratch",
        path: workspacePath,
        commandId: "api-create-scratch"
      })
      .expect(201);
    expect(created.body).toMatchObject({
      id: "api-scratch",
      kind: "scratch",
      path: workspacePath,
      state: "ready"
    });
    await writeFile(join(workspacePath, "preserved.txt"), "preserved");

    await request(app.getHttpServer())
      .post("/api/workspaces/api-scratch/delete")
      .send({ commandId: "api-delete-missing" })
      .expect(428)
      .expect(({ body }) => expect(body).toMatchObject({
        code: "CONFIRMATION_REQUIRED",
        confirmation: {
          action: "workspace.delete",
          cwd: workspacePath,
          scope: "once",
          workspaceId: "api-scratch"
        }
      }));

    const confirmation = await request(app.getHttpServer())
      .post("/api/confirmations")
      .send({
        action: "workspace.delete",
        target: { path: workspacePath, workspaceId: "api-scratch" },
        cwd: workspacePath,
        risk: "destructive",
        scope: "once",
        workspaceId: "api-scratch",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        commandId: "api-request-delete"
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/confirmations/${confirmation.body.id}/decide`)
      .send({
        decision: "approved",
        actor: "human",
        comment: "reviewed",
        commandId: "api-decide-delete"
      })
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/workspaces/api-scratch/delete")
      .send({
        confirmationId: confirmation.body.id,
        commandId: "api-delete"
      })
      .expect(201)
      .expect(({ body }) => expect(body.state).toBe("deleted"));
    expect(await readFile(join(workspacePath, "preserved.txt"), "utf8")).toBe("preserved");

    await request(app.getHttpServer())
      .post("/api/workspaces/api-scratch/restore")
      .send({ commandId: "api-restore" })
      .expect(201)
      .expect(({ body }) => expect(body.state).toBe("ready"));
  });

  it("rejects strict DTO extras and exact target mismatch before workspace activity", async () => {
    await request(app.getHttpServer())
      .post("/api/workspaces")
      .send({
        id: "api-scratch",
        kind: "scratch",
        path: workspacePath,
        unexpected: true,
        commandId: "api-invalid"
      })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe("REQUEST_INVALID"));
  });
});
