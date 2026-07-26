import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DispatchWorkflowOutbox,
  ManageConfirmations,
  ProviderRegistry,
  ReconcileWorkflows
} from "@nodra/application";
import {
  LazyTemporalConnection,
  LocalWorkspaceAdapter,
  migrateDatabase,
  NodraSqliteDatabase,
  SqliteConfirmationRepository,
  SqliteProviderCatalogRepository,
  SqliteProviderPermissionHandler,
  SqliteProviderRunStore,
  SqliteRunWorkflowActivity,
  SqliteWorkflowOutboxStore,
  SqliteWorkflowReconciliationStore,
  TemporalRunActivities,
  TemporalWorkflowAdapter
} from "@nodra/adapters";
import { eq } from "drizzle-orm";
import { inbox, outbox } from "../../packages/adapters/src/sqlite/schema/operations.js";
import { providerEvents } from "../../packages/adapters/src/sqlite/schema/provider-events.js";
import { runs } from "../../packages/adapters/src/sqlite/schema/runs.js";
import { DeterministicProvider } from "./deterministic-provider.js";
import {
  POC_OCCURRED_AT,
  persistPocStart,
  saveDeterministicCatalog,
  seedPocMission
} from "./poc-fixture.js";
import { TemporalDevServer } from "./temporal-dev-server.js";
import { TemporalWorkerHarness } from "./temporal-worker-harness.js";

if (process.env.NODRA_TEST_TEMPORAL_RUNTIME !== "1") {
  throw new Error("Set NODRA_TEST_TEMPORAL_RUNTIME=1 to run the real, local-only Temporal POC");
}

const root = resolve(".");
const dataRoot = await mkdtemp(join(tmpdir(), "nodra-i6-2-"));
const databaseFile = join(dataRoot, "nodra.db");
const workflowPath = resolve("packages/adapters/src/temporal/workflows/mission-workflow.ts");
let database: NodraSqliteDatabase | undefined;
let runtime: LazyTemporalConnection | undefined;
let server: TemporalDevServer | undefined;
let workerHarness: TemporalWorkerHarness | undefined;
let report: Record<string, unknown> | undefined;

const invariant: (condition: unknown, detail: string) => asserts condition = (condition, detail) => {
  if (!condition) throw new Error(`I6.2 POC invariant failed: ${detail}`);
};

const waitFor = async (predicate: () => boolean, detail: string): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Timed out waiting for ${detail}`);
};

try {
  server = await TemporalDevServer.start(dataRoot);
  runtime = new LazyTemporalConnection({
    address: server.address,
    namespace: server.namespace,
    connectTimeoutMs: 1_000
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await runtime.check()).status === "ok") break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  invariant((await runtime.check()).status === "ok", "server and nodra namespace health");

  const absentRuntime = new LazyTemporalConnection({
    address: "127.0.0.1:1",
    namespace: server.namespace,
    connectTimeoutMs: 100
  });
  invariant((await absentRuntime.check()).status === "error", "an absent Temporal server is a real error");
  await absentRuntime.close();

  database = NodraSqliteDatabase.open(databaseFile);
  await migrateDatabase(database, resolve(root, "packages/adapters/drizzle"));
  const workspaceRoot = join(dataRoot, "workspaces");
  await mkdir(workspaceRoot, { recursive: true });
  const workspaceAdapter = new LocalWorkspaceAdapter(workspaceRoot);
  await workspaceAdapter.initialize();
  const catalog = new SqliteProviderCatalogRepository(database);
  const provider = new DeterministicProvider();
  const providerRuns = new SqliteProviderRunStore(database);
  const permissions = new SqliteProviderPermissionHandler(
    new ManageConfirmations(new SqliteConfirmationRepository(database), workspaceAdapter),
    providerRuns
  );
  const activities = new TemporalRunActivities(
    new SqliteRunWorkflowActivity(database),
    new ProviderRegistry([provider]),
    providerRuns,
    permissions,
    catalog
  );
  const client = await runtime.client();
  const workflows = new TemporalWorkflowAdapter(client);
  const outboxStore = new SqliteWorkflowOutboxStore(database);
  await saveDeterministicCatalog(catalog, provider);
  workerHarness = new TemporalWorkerHarness(
    server.address,
    server.namespace,
    workflowPath,
    activities
  );

  workerHarness.start();
  seedPocMission(database, workspaceRoot, provider.providerId, "provider-terminal");
  await persistPocStart(database, runtime, catalog, "provider-terminal");
  const terminalDispatch = await new DispatchWorkflowOutbox(outboxStore, workflows)
    .execute({ limit: 10, occurredAt: POC_OCCURRED_AT });
  invariant(terminalDispatch.accepted === 1, "provider workflow dispatch");
  await client.getHandle("mission/provider-terminal").result();
  invariant(provider.executionCount === 1, "exactly one deterministic provider Activity");
  invariant(
    database.orm.select().from(runs).where(eq(runs.id, "run-provider-terminal")).get()?.state === "SUCCEEDED",
    "provider run terminal state"
  );
  invariant(
    database.orm.select().from(providerEvents)
      .where(eq(providerEvents.runId, "run-provider-terminal")).all().length === 3,
    "provider Activity event persistence"
  );

  seedPocMission(database, workspaceRoot, provider.providerId, "worker-restart");
  await persistPocStart(database, runtime, undefined, "worker-restart");
  const crashingDispatcher = new DispatchWorkflowOutbox(outboxStore, workflows, {
    accepted: async () => {
      throw new Error("I6.2 simulated dispatcher crash after Temporal accepted start");
    }
  });
  await crashingDispatcher.execute({ limit: 10, occurredAt: POC_OCCURRED_AT }).then(
    () => { throw new Error("The simulated dispatcher crash did not occur"); },
    (error: unknown) => {
      invariant(error instanceof Error && error.message.includes("simulated dispatcher crash"), "crash checkpoint");
    }
  );
  await waitFor(
    () => database!.orm.select().from(runs).where(eq(runs.id, "run-worker-restart")).get()?.state === "STARTING",
    "recordStarted Activity before worker shutdown"
  );
  const parentRunBeforeRestart = (
    await client.getHandle("mission/worker-restart").describe()
  ).runId;
  invariant(
    database.orm.select().from(outbox).where(eq(outbox.id, "outbox-worker-restart")).get()?.publishedAt === null,
    "outbox remains pending after dispatcher crash"
  );

  await workerHarness.stop();
  invariant(
    database.orm.select().from(runs).where(eq(runs.id, "run-worker-restart")).get()?.state === "STARTING",
    "SQLite state survives worker shutdown"
  );
  workerHarness.start();
  const reconciliation = await new ReconcileWorkflows(
    new SqliteWorkflowReconciliationStore(database),
    workflows
  ).execute();
  invariant(
    reconciliation.items.some((item) =>
      item.workflowId === "mission/worker-restart" && item.status === "reachable"
    ),
    "workflow reconciliation after worker restart"
  );
  const recoveryDispatch = await new DispatchWorkflowOutbox(outboxStore, workflows)
    .execute({ limit: 10, occurredAt: POC_OCCURRED_AT });
  invariant(recoveryDispatch.accepted === 1, "pending outbox recovery");
  const parentRunAfterRestart = (
    await client.getHandle("mission/worker-restart").describe()
  ).runId;
  invariant(parentRunAfterRestart === parentRunBeforeRestart, "same Temporal parent after redispatch");
  invariant(
    (await new DispatchWorkflowOutbox(outboxStore, workflows)
      .execute({ limit: 10, occurredAt: POC_OCCURRED_AT })).accepted === 0,
    "published outbox redispatch is empty"
  );
  await workflows.signal("mission/worker-restart", { type: "cancel" });
  await client.getHandle("mission/worker-restart").result();
  invariant(
    database.orm.select().from(runs).where(eq(runs.id, "run-worker-restart")).get()?.state === "CANCELLED",
    "terminal Activity after worker restart"
  );
  invariant(database.orm.select().from(inbox).all().length === 4, "one start and terminal inbox effect per run");
  invariant(
    database.orm.select().from(outbox).all().every((message) => message.publishedAt !== null),
    "all outbox messages published once"
  );

  await workerHarness.stop();
  report = {
    status: "ok",
    temporal: {
      version: server.version,
      address: server.address,
      namespace: server.namespace,
      databaseFile: server.databaseFile
    },
    nodra: {
      databaseFile,
      dataRoot
    },
    proof: {
      workflowStart: "ok",
      deterministicProviderActivity: "ok",
      providerExecutions: provider.executionCount,
      providerTerminal: "SUCCEEDED",
      workerRestart: "ok",
      reconciliation: "reachable",
      outboxPendingRecovery: "same-parent",
      inboxEffects: database.orm.select().from(inbox).all().length,
      recoveredTerminal: "CANCELLED"
    }
  };
} finally {
  await workerHarness?.forceCleanup();
  await runtime?.close().catch(() => undefined);
  database?.close();
  await server?.stop().catch(() => undefined);
  await rm(dataRoot, { recursive: true, force: true });
}

if (report) {
  process.stdout.write(`${JSON.stringify({ ...report, cleanup: "complete" }, null, 2)}\n`);
}
