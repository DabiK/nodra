import "reflect-metadata";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./create-app.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4100);
const app = await createApp({
  databaseFile: resolve(process.env.NODRA_DATABASE_FILE ?? `${root}/data/nodra.db`),
  dataRoot: resolve(process.env.NODRA_DATA_ROOT ?? `${root}/data`),
  repositoryRoot: resolve(root),
  migrationsDirectory: resolve(root, "packages/adapters/drizzle"),
  temporalAddress: process.env.NODRA_TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
  temporalNamespace: process.env.NODRA_TEMPORAL_NAMESPACE ?? "nodra"
});
app.enableShutdownHooks(["SIGINT", "SIGTERM"]);
await app.listen(port, host);
process.stdout.write(`Nodra API ready on http://${host}:${port}\n`);
