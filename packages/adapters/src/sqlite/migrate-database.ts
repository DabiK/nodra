import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readDrizzleMigrationCatalog, type DrizzleMigration } from "./drizzle-migration-catalog.js";
import { MigrationIntegrityError } from "./migration-integrity-error.js";
import { schemaMigration } from "./schema/core.js";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";

interface RegisteredMigration {
  version: number;
  checksum: string;
}

export interface MigrationResult {
  version: number;
  checksum: string;
  registeredVersions: number[];
}

const readRegisteredMigrations = (database: NodraSqliteDatabase): RegisteredMigration[] => {
  const exists = database.connection
    .prepare("select 1 from sqlite_master where type = 'table' and name = 'schema_migration'")
    .get();
  if (!exists) return [];
  return database.connection
    .prepare("select version, checksum from schema_migration order by version")
    .all() as RegisteredMigration[];
};

const verifyRegisteredMigrations = (
  registered: readonly RegisteredMigration[],
  catalog: readonly DrizzleMigration[]
): void => {
  const catalogByVersion = new Map(catalog.map((migration) => [migration.version, migration]));
  for (const migration of registered) {
    const expected = catalogByVersion.get(migration.version);
    if (!expected) {
      throw new MigrationIntegrityError(
        `Registered migration version ${migration.version} is missing from the Drizzle journal`,
        "MIGRATION_MISSING"
      );
    }
    if (expected.checksum !== migration.checksum) {
      throw new MigrationIntegrityError(
        `Checksum mismatch for registered migration ${migration.version} (${expected.tag}.sql)`,
        "MIGRATION_CHANGED"
      );
    }
  }
};

export const migrateDatabase = async (
  database: NodraSqliteDatabase,
  migrationsDirectory: string
): Promise<MigrationResult> => {
  const catalog = await readDrizzleMigrationCatalog(migrationsDirectory);
  const registered = readRegisteredMigrations(database);
  verifyRegisteredMigrations(registered, catalog);
  migrate(database.orm, { migrationsFolder: migrationsDirectory });
  const registeredVersions = new Set(registered.map(({ version }) => version));
  const newMigrations = catalog.filter(({ version }) => !registeredVersions.has(version));
  if (newMigrations.length) {
    const appliedAt = new Date().toISOString();
    database.orm.insert(schemaMigration).values(
      newMigrations.map(({ version, checksum }) => ({ version, checksum, appliedAt }))
    ).run();
  }
  const latest = catalog.at(-1);
  if (!latest) throw new MigrationIntegrityError("No Drizzle migration found", "MIGRATION_MISSING");
  return {
    version: latest.version,
    checksum: latest.checksum,
    registeredVersions: newMigrations.map(({ version }) => version)
  };
};
