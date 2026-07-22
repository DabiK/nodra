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

    expect(result).toMatchObject({ version: 2, registeredVersions: [1, 2] });
    expect(registeredMigrations(database)).toEqual([
      expect.objectContaining({ version: 1 }),
      expect.objectContaining({ version: 2, checksum: result.checksum })
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
      tag: "0002_multi_migration_probe",
      breakpoints: true
    });
    await writeFile(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
    await writeFile(
      join(migrationsDirectory, "0002_multi_migration_probe.sql"),
      "CREATE TABLE `migration_probe` (`id` integer PRIMARY KEY NOT NULL);\n"
    );

    const result = await migrateDatabase(database, migrationsDirectory);

    expect(result).toMatchObject({ version: 3, registeredVersions: [1, 2, 3] });
    expect(registeredMigrations(database).map(({ version }) => version)).toEqual([1, 2, 3]);
    expect(database.connection.prepare("select name from sqlite_master where name = 'migration_probe'").get()).toBeTruthy();
  });
});
