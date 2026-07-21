import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CreateMission } from "@nodra/application";
import { asId } from "@nodra/domain";
import { describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrate-database.js";
import { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { SqliteMissionRepository } from "./sqlite-mission-repository.js";
import { verifyDatabase } from "./verify-database.js";

describe("SQLite persistence", () => {
  it("migrates a blank database and persists a mission through the application port", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-sqlite-"));
    const database = NodraSqliteDatabase.open(join(directory, "nodra.db"));
    try {
      await migrateDatabase(database, resolve("packages/adapters/drizzle"));
      expect(verifyDatabase(database)).toMatchObject({
        foreignKeys: true,
        journalMode: "wal",
        migrationVersion: 1
      });
      const repository = new SqliteMissionRepository(database);
      await new CreateMission(repository).execute({
        id: asId("mission-sqlite"),
        title: "Persist the first Nodra mission",
        executionKind: "human",
        now: "2026-07-21T12:00:00.000Z"
      });
      const mission = await repository.load(asId("mission-sqlite"));
      if (!mission) throw new Error("Expected the persisted mission");
      mission.markReady("2026-07-21T12:01:00.000Z");
      await repository.save(mission, 0);

      expect((await repository.load(asId("mission-sqlite")))?.snapshot()).toMatchObject({
        state: "READY",
        version: 1
      });
    } finally {
      database.close();
    }
  });
});
