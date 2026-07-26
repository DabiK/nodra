import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ManageConfirmations, toId } from "@nodra/application";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrate-database.js";
import { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { SqliteConfirmationRepository } from "./sqlite-confirmation-repository.js";

describe("SqliteConfirmationRepository", () => {
  let database: NodraSqliteDatabase;
  let concurrentDatabase: NodraSqliteDatabase | undefined;
  let confirmations: ManageConfirmations;
  const now = "2026-07-26T10:00:00.000Z";
  const context = (commandId: string, occurredAt = now) => ({
    commandId: toId(commandId),
    actor: "user" as const,
    occurredAt
  });

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-confirmation-"));
    database = NodraSqliteDatabase.open(join(directory, "db.sqlite"));
    await migrateDatabase(database, resolve("packages/adapters/drizzle"));
    database.connection.prepare(
      "insert into workspace(id,project_id,kind,path,state,created_at) values ('ws',null,'scratch','/tmp/ws','ready',?)"
    ).run(now);
    confirmations = new ManageConfirmations(
      new SqliteConfirmationRepository(database),
      { canonicalizeExisting: async (path) => path }
    );
  });

  afterEach(() => {
    concurrentDatabase?.close();
    database.close();
  });

  it("validates exact scope subjects and canonicalizes target keys", async () => {
    await expect(confirmations.request({
      id: toId("invalid"),
      action: "git.commit",
      target: {},
      risk: "write",
      scope: "run",
      missionId: toId("mission"),
      expiresAt: "2026-07-26T10:01:00.000Z",
      context: context("invalid")
    })).rejects.toMatchObject({ code: "CONFIRMATION_INVALID" });

    const record = await confirmations.request({
      id: toId("canonical"),
      action: "workspace.delete",
      target: { workspaceId: "ws", nested: { z: 1, a: 2 } },
      cwd: "/tmp/ws",
      risk: "delete",
      scope: "once",
      workspaceId: toId("ws"),
      expiresAt: "2026-07-26T10:01:00.000Z",
      context: context("canonical")
    });
    expect(record.targetJson).toBe('{"nested":{"a":2,"z":1},"workspaceId":"ws"}');
    expect(record.targetDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(() => database.connection.prepare(
      "update confirmation set action='git.push' where id='canonical'"
    ).run()).toThrow(/confirmation exact fields are immutable/);
    expect(() => database.connection.prepare(
      "update confirmation set state='consumed' where id='canonical'"
    ).run()).toThrow(/invalid confirmation state transition/);
  });

  it("consumes one approved exact confirmation once under concurrency", async () => {
    await confirmations.request({
      id: toId("concurrent"),
      action: "workspace.delete",
      target: { workspaceId: "ws" },
      cwd: "/tmp/ws",
      risk: "delete",
      scope: "once",
      workspaceId: toId("ws"),
      expiresAt: "2026-07-26T10:01:00.000Z",
      context: context("request")
    });
    await confirmations.decide({
      id: toId("concurrent"),
      decision: "approved",
      actor: "human",
      comment: "ok",
      context: context("decide")
    });
    const databaseFile = database.connection.name;
    concurrentDatabase = NodraSqliteDatabase.open(databaseFile);
    const concurrentConfirmations = new ManageConfirmations(
      new SqliteConfirmationRepository(concurrentDatabase),
      { canonicalizeExisting: async (path) => path }
    );
    const results = await Promise.allSettled([
      concurrentConfirmations.consume({
        id: toId("concurrent"),
        action: "workspace.delete",
        target: { workspaceId: "ws" },
        cwd: "/tmp/ws",
        scope: "once",
        workspaceId: toId("ws"),
        context: context("consume-a")
      }),
      confirmations.consume({
        id: toId("concurrent"),
        action: "workspace.delete",
        target: { workspaceId: "ws" },
        cwd: "/tmp/ws",
        scope: "once",
        workspaceId: toId("ws"),
        context: context("consume-b")
      })
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      reason: { code: "CONFIRMATION_ALREADY_CONSUMED" }
    });
  });

  it("distinguishes target mismatch and persists expiration at the exact boundary", async () => {
    await confirmations.request({
      id: toId("mismatch"),
      action: "workspace.delete",
      target: { workspaceId: "ws" },
      cwd: "/tmp/ws",
      risk: "delete",
      scope: "once",
      workspaceId: toId("ws"),
      expiresAt: "2026-07-26T10:01:00.000Z",
      context: context("request-mismatch")
    });
    await confirmations.decide({
      id: toId("mismatch"),
      decision: "approved",
      actor: "human",
      comment: "ok",
      context: context("decide-mismatch")
    });
    await expect(confirmations.consume({
      id: toId("mismatch"),
      action: "workspace.delete",
      target: { workspaceId: "other" },
      cwd: "/tmp/ws",
      scope: "once",
      workspaceId: toId("ws"),
      context: context("consume-mismatch")
    })).rejects.toMatchObject({ code: "CONFIRMATION_TARGET_MISMATCH" });
    expect((await confirmations.show(toId("mismatch"))).state).toBe("approved");

    await confirmations.request({
      id: toId("expired"),
      action: "workspace.delete",
      target: { workspaceId: "ws" },
      cwd: "/tmp/ws",
      risk: "delete",
      scope: "once",
      workspaceId: toId("ws"),
      expiresAt: now,
      context: context("request-expired", "2026-07-26T09:59:59.999Z")
    });
    await expect(confirmations.decide({
      id: toId("expired"),
      decision: "approved",
      actor: "human",
      comment: "late",
      context: context("decide-expired")
    })).rejects.toMatchObject({ code: "CONFIRMATION_EXPIRED" });
    expect((await confirmations.show(toId("expired"))).state).toBe("expired");
  });
});
