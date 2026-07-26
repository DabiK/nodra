import {
  migrateDatabase,
  missionWorkflowPath,
  CodexProviderAdapter,
  OpenCodeProviderAdapter,
  LocalWorkspaceAdapter,
  NodraSqliteDatabase,
  SqliteConfirmationRepository,
  SqliteProviderPermissionHandler,
  SqliteProviderCatalogRepository,
  SqliteProviderRunStore,
  SqliteRunWorkflowActivity,
  TemporalRunActivities,
  TemporalMissionWorker
} from "@nodra/adapters";
import { ManageConfirmations, ProviderRegistry } from "@nodra/application";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const databaseFile = resolve(process.env.NODRA_DATABASE_FILE ?? `${root}/data/nodra.db`);
await mkdir(dirname(databaseFile), { recursive: true });
const database = NodraSqliteDatabase.open(databaseFile);
await migrateDatabase(database, resolve(root, "packages/adapters/drizzle"));

const dataRoot = resolve(process.env.NODRA_DATA_ROOT ?? dirname(databaseFile));
const workspace = new LocalWorkspaceAdapter(`${dataRoot}/workspaces`);
await workspace.initialize();
const providerRuns = new SqliteProviderRunStore(database);
const providerCatalog = new SqliteProviderCatalogRepository(database);
const permissions = new SqliteProviderPermissionHandler(
  new ManageConfirmations(new SqliteConfirmationRepository(database), workspace),
  providerRuns
);
const activities = new TemporalRunActivities(
  new SqliteRunWorkflowActivity(database),
  new ProviderRegistry([
    new CodexProviderAdapter(),
    new OpenCodeProviderAdapter({
      baseUrl: process.env.NODRA_OPENCODE_URL ?? "http://127.0.0.1:4096"
    })
  ]),
  providerRuns,
  permissions,
  providerCatalog
);
const worker = new TemporalMissionWorker({
  address: process.env.NODRA_TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
  namespace: process.env.NODRA_TEMPORAL_NAMESPACE ?? "nodra",
  workflowsPath: missionWorkflowPath()
}, activities);

const shutdown = (): void => worker.shutdown();
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  await worker.run(async () => {
    const readinessFile = process.env.NODRA_WORKER_READY_FILE;
    if (!readinessFile) return;
    await mkdir(dirname(readinessFile), { recursive: true });
    const temporaryFile = `${readinessFile}.${process.pid}.tmp`;
    await writeFile(temporaryFile, JSON.stringify({
      pid: process.pid,
      ownerPid: Number(process.env.NODRA_RUNTIME_GROUP_LEADER_PID ?? process.pid),
      readyAt: new Date().toISOString(),
      temporalAddress: process.env.NODRA_TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
      temporalNamespace: process.env.NODRA_TEMPORAL_NAMESPACE ?? "nodra",
      taskQueue: worker.taskQueue
    }, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    await rename(temporaryFile, readinessFile);
  });
} finally {
  await worker.close();
  database.close();
}
