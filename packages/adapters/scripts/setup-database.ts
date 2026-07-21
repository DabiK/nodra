import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { migrateDatabase } from "../src/sqlite/migrate-database.js";
import { NodraSqliteDatabase } from "../src/sqlite/nodra-sqlite-database.js";
import { verifyDatabase } from "../src/sqlite/verify-database.js";

const databaseFile = resolve(process.argv[2] ?? process.env.NODRA_DATABASE_FILE ?? "data/nodra.db");
const migrationsDirectory = resolve("packages/adapters/drizzle");
await mkdir(dirname(databaseFile), { recursive: true });
const database = NodraSqliteDatabase.open(databaseFile);

try {
  const migration = await migrateDatabase(database, migrationsDirectory);
  const verification = verifyDatabase(database);
  process.stdout.write(`${JSON.stringify({ databaseFile, migration, verification }, null, 2)}\n`);
} finally {
  database.close();
}
