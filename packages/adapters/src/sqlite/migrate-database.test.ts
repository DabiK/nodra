import { cp, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MigrationIntegrityError } from "./migration-integrity-error.js";
import { migrateDatabase } from "./migrate-database.js";
import { NodraSqliteDatabase } from "./nodra-sqlite-database.js";

const databases: NodraSqliteDatabase[] = [];

const createFixture = async (): Promise<{ database: NodraSqliteDatabase; migrationsDirectory: string }> => {
  const directory = await mkdtemp(join(tmpdir(), "nodra-migrations-"));
  const migrationsDirectory = join(directory, "drizzle");
  await cp(resolve("packages/adapters/drizzle"), migrationsDirectory, { recursive: true });
  const database = NodraSqliteDatabase.open(join(directory, "nodra.db"));
  databases.push(database);
  return { database, migrationsDirectory };
};

const registeredMigrations = (database: NodraSqliteDatabase) =>
  database.connection
    .prepare("select version, checksum, applied_at as appliedAt from schema_migration order by version")
    .all() as Array<{ version: number; checksum: string; appliedAt: string }>;

afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
});

describe("migrateDatabase", () => {
  it("registers the journal migration on a blank database", async () => {
    const { database, migrationsDirectory } = await createFixture();

    const result = await migrateDatabase(database, migrationsDirectory);

    expect(result).toMatchObject({ version: 12, registeredVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
    expect(registeredMigrations(database)).toEqual([
      expect.objectContaining({ version: 1 }),
      expect.objectContaining({ version: 2 }),
      expect.objectContaining({ version: 3 }),
      expect.objectContaining({ version: 4 }),
      expect.objectContaining({ version: 5 }),
      expect.objectContaining({ version: 6 }),
      expect.objectContaining({ version: 7 }),
      expect.objectContaining({ version: 8 }),
      expect.objectContaining({ version: 9 }),
      expect.objectContaining({ version: 10 }),
      expect.objectContaining({ version: 11 }),
      expect.objectContaining({ version: 12, checksum: result.checksum })
    ]);
  });

  it("is idempotent and preserves the original registry row", async () => {
    const { database, migrationsDirectory } = await createFixture();
    await migrateDatabase(database, migrationsDirectory);
    const firstRegistry = registeredMigrations(database);

    const result = await migrateDatabase(database, migrationsDirectory);

    expect(result.registeredVersions).toEqual([]);
    expect(registeredMigrations(database)).toEqual(firstRegistry);
  });

  it("upgrades a database at I4 migration 0001 to the unique approval-consumption index in 0002", async () => {
    const { database, migrationsDirectory } = await createFixture();
    const journalFile = join(migrationsDirectory, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalFile, "utf8")) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 2);
    await writeFile(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
    await unlink(join(migrationsDirectory, "0002_boring_ultimates.sql"));
    expect(await migrateDatabase(database, migrationsDirectory)).toMatchObject({ version: 2, registeredVersions: [1, 2] });

    const upgraded = await migrateDatabase(database, resolve("packages/adapters/drizzle"));

    expect(upgraded).toMatchObject({ version: 12, registeredVersions: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
    expect(database.connection.prepare("select name from sqlite_master where type = 'index' and name = 'gate_override_approval_id_unique'").get()).toBeTruthy();
    expect(database.connection.prepare("select name from sqlite_master where type = 'index' and name = 'idx_confirmation_state_expires'").get()).toBeTruthy();
    expect(database.connection.prepare("select name from sqlite_master where type = 'trigger' and name = 'confirmation_exact_fields_immutable'").get()).toBeTruthy();
    expect(database.connection.prepare("select name from sqlite_master where type = 'trigger' and name = 'workspace_state_transition'").get()).toBeTruthy();
  });

  it("preserves existing read-only provider links while adding the control mode", async () => {
    const { database, migrationsDirectory } = await createFixture();
    const journalFile = join(migrationsDirectory, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalFile, "utf8")) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 11);
    await writeFile(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
    await unlink(join(migrationsDirectory, "0011_deep_power_pack.sql"));
    await migrateDatabase(database, migrationsDirectory);
    database.connection.prepare(`
      insert into mission(id, project_id, title, execution_kind, state, version, temporal_parent_workflow_id, created_at, updated_at, deleted_at)
      values('mission-existing-provider', null, 'Existing provider mission', 'agent', 'READY', 1, null, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', null)
    `).run();
    database.connection.prepare(`
      insert into provider_session(id, provider_id, external_session_ref, ownership, first_observed_at, last_observed_at)
      values('session-existing', 'codex', 'thread-existing', 'external_observed', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')
    `).run();
    database.connection.prepare(`
      insert into provider_session_link(id, provider_session_id, mission_id, mode, attached_at, detached_at)
      values('link-existing', 'session-existing', 'mission-existing-provider', 'read_only', '2026-08-01T00:00:00.000Z', null)
    `).run();

    await migrateDatabase(database, resolve("packages/adapters/drizzle"));

    expect(database.connection.prepare("select mode from provider_session_link where id = 'link-existing'").get())
      .toEqual({ mode: "read_only" });
    expect(database.connection.prepare("pragma foreign_key_check").all()).toEqual([]);
  });

  it("rejects an altered registered migration before changing the registry", async () => {
    const { database, migrationsDirectory } = await createFixture();
    await migrateDatabase(database, migrationsDirectory);
    const firstRegistry = registeredMigrations(database);
    const migrationFile = join(migrationsDirectory, "0000_watery_onslaught.sql");
    const source = await readFile(migrationFile, "utf8");
    await writeFile(migrationFile, `${source}\n-- altered after application\n`);

    const attempt = migrateDatabase(database, migrationsDirectory);

    await expect(attempt).rejects.toMatchObject({
      code: "MIGRATION_CHANGED"
    } satisfies Partial<MigrationIntegrityError>);
    expect(registeredMigrations(database)).toEqual(firstRegistry);
  });

  it("rejects a missing journal migration before changing the registry", async () => {
    const { database, migrationsDirectory } = await createFixture();
    await migrateDatabase(database, migrationsDirectory);
    const firstRegistry = registeredMigrations(database);
    await unlink(join(migrationsDirectory, "0000_watery_onslaught.sql"));

    await expect(migrateDatabase(database, migrationsDirectory)).rejects.toMatchObject({
      code: "MIGRATION_MISSING"
    } satisfies Partial<MigrationIntegrityError>);
    expect(registeredMigrations(database)).toEqual(firstRegistry);
  });

  it("applies and registers multiple migrations in Drizzle journal order", async () => {
    const { database, migrationsDirectory } = await createFixture();
    const journalFile = join(migrationsDirectory, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalFile, "utf8")) as {
      entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
    };
    const first = journal.entries[0];
    const last = journal.entries.at(-1);
    if (!first || !last) throw new Error("Expected migration journal entries");
    const nextIndex = journal.entries.length;
    journal.entries.push({
      idx: nextIndex,
      version: first.version,
      when: last.when + 1,
      tag: "0012_multi_migration_probe",
      breakpoints: true
    });
    await writeFile(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
    await writeFile(
      join(migrationsDirectory, "0012_multi_migration_probe.sql"),
      "CREATE TABLE `migration_probe` (`id` integer PRIMARY KEY NOT NULL);\n"
    );

    const result = await migrateDatabase(database, migrationsDirectory);

    expect(result).toMatchObject({ version: 13, registeredVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] });
    expect(registeredMigrations(database).map(({ version }) => version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(database.connection.prepare("select name from sqlite_master where name = 'migration_probe'").get()).toBeTruthy();
  });
});
