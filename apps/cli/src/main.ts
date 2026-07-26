import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./run-cli.js";
import { readRuntimeEnvironment } from "./runtime-environment.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const runtime = readRuntimeEnvironment(root);
const databaseFile = resolve(runtime.databaseFile);
const migrationsDirectory = resolve(root, "packages/adapters/drizzle");

process.exitCode = await runCli(
  process.argv.slice(2),
  databaseFile,
  migrationsDirectory,
  runtime.temporalAddress,
  runtime.temporalNamespace,
  runtime.dataRoot
);
