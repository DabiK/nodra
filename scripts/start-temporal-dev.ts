import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { readTemporalLocalConfig } from "./temporal-local-config.js";

const config = readTemporalLocalConfig();
const version = spawnSync("temporal", ["--disable-config-file", "--disable-config-env", "--version"], {
  encoding: "utf8"
});
if (version.error || version.status !== 0) {
  throw new Error("Temporal CLI is required on PATH; install it explicitly before starting Nodra dev runtime");
}

await mkdir(dirname(config.temporalDatabaseFile), { recursive: true });
process.stdout.write(`${JSON.stringify({
  mode: "development-only",
  temporalCli: version.stdout.trim(),
  address: config.address,
  namespace: config.namespace,
  temporalDatabaseFile: config.temporalDatabaseFile,
  dataRoot: config.dataRoot
}, null, 2)}\n`);

const child = spawn("temporal", [
  "--disable-config-file",
  "--disable-config-env",
  "server",
  "start-dev",
  "--headless",
  "--ip",
  config.ip,
  "--port",
  String(config.port),
  "--namespace",
  config.namespace,
  "--db-filename",
  config.temporalDatabaseFile
], { stdio: "inherit" });

const stop = (): void => {
  if (child.exitCode === null) child.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

const exitCode = await new Promise<number>((resolveExit, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    resolveExit(code ?? (signal ? 1 : 0));
  });
});
process.exitCode = exitCode;
