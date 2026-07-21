import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./run-cli.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const databaseFile = resolve(process.env.NODRA_DATABASE_FILE ?? `${root}/data/nodra.db`);
const migrationsDirectory = resolve(root, "packages/adapters/drizzle");

process.exitCode = await runCli(process.argv.slice(2), databaseFile, migrationsDirectory);
