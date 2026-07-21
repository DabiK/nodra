import {
  migrateDatabase,
  missionWorkflowPath,
  NodraSqliteDatabase,
  SqliteMissionWorkflowActivity,
  TemporalMissionActivities,
  TemporalMissionWorker
} from "@nodra/adapters";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const databaseFile = resolve(process.env.NODRA_DATABASE_FILE ?? `${root}/data/nodra.db`);
await mkdir(dirname(databaseFile), { recursive: true });
const database = NodraSqliteDatabase.open(databaseFile);
await migrateDatabase(database, resolve(root, "packages/adapters/drizzle"));

const activities = new TemporalMissionActivities(new SqliteMissionWorkflowActivity(database));
const worker = new TemporalMissionWorker({
  address: process.env.NODRA_TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
  namespace: process.env.NODRA_TEMPORAL_NAMESPACE ?? "nodra",
  workflowsPath: missionWorkflowPath()
}, activities);

const shutdown = (): void => worker.shutdown();
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  await worker.run();
} finally {
  await worker.close();
  database.close();
}
