import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { schemaMigration } from "./schema/core.js";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";

export const migrateDatabase = async (
  database: NodraSqliteDatabase,
  migrationsDirectory: string
): Promise<{ version: number; checksum: string }> => {
  migrate(database.orm, { migrationsFolder: migrationsDirectory });
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  if (migrationFiles.length !== 1) {
    throw new Error(`Expected one Nodra V1 baseline migration, found ${migrationFiles.length}`);
  }
  const migration = await readFile(`${migrationsDirectory}/${migrationFiles[0]}`, "utf8");
  const checksum = createHash("sha256").update(migration).digest("hex");
  database.orm
    .insert(schemaMigration)
    .values({ version: 1, checksum, appliedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: schemaMigration.version,
      set: { checksum }
    })
    .run();
  return { version: 1, checksum };
};
