import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import request from "supertest";
import { it } from "vitest";
import {
  LazyTemporalConnection,
  CodexProviderAdapter,
  LocalWorkspaceAdapter,
  migrateDatabase,
  NodraSqliteDatabase,
  SqliteConfirmationRepository,
  SqliteProviderCatalogRepository,
  SqliteProviderPermissionHandler,
  SqliteProviderRunStore,
  SqliteRunWorkflowActivity,
  TemporalRunActivities
} from "@nodra/adapters";
import { ManageConfirmations, ProviderRegistry } from "@nodra/application";
import type { ProviderPort } from "@nodra/application";
import { createApp } from "./src/create-app.js";
import { outbox } from "../../packages/adapters/src/sqlite/schema/operations.js";
import { providerEvents } from "../../packages/adapters/src/sqlite/schema/provider-events.js";
import { runs } from "../../packages/adapters/src/sqlite/schema/runs.js";
import { missions } from "../../packages/adapters/src/sqlite/schema/missions.js";
import { conversationItems } from "../../packages/adapters/src/sqlite/schema/conversations.js";
import { eq } from "drizzle-orm";
import { DeterministicProvider } from "../../poc/temporal/deterministic-provider.js";
import { saveDeterministicCatalog } from "../../poc/temporal/poc-fixture.js";
import { TemporalDevServer } from "../../poc/temporal/temporal-dev-server.js";
import { TemporalWorkerHarness } from "../../poc/temporal/temporal-worker-harness.js";

const realCodex = process.env.NODRA_I7_PROVIDER === "codex";
const deterministicI8 = process.env.NODRA_TEST_I8_DETERMINISTIC === "1";
const e2eLabel = deterministicI8 ? "I8 deterministic E2E" : "I7 E2E";
const enabled = realCodex
  ? process.env.NODRA_TEST_REAL_CODEX_I7 === "1"
  : process.env.NODRA_TEST_I7_TEMPORAL === "1" || deterministicI8;

const root = resolve(".");
let dataRoot = "";
let databaseFile = "";
const migrationsDirectory = resolve(root, "packages/adapters/drizzle");
const deterministicProvider = realCodex
  ? null
  : new DeterministicProvider(deterministicI8 ? "opencode" : undefined);
const provider: ProviderPort = realCodex ? new CodexProviderAdapter() : deterministicProvider!;
const providerId = provider.providerId;
const modelId = realCodex ? "gpt-5.4-mini" : "fixture-model";
const missionPrompt = realCodex
  ? "Reply with exactly NODRA_I7_CODEX_OK. Do not use tools."
  : "Return the deterministic I7 marker";
let server: TemporalDevServer | undefined;
let runtime: LazyTemporalConnection | undefined;
let workerDatabase: NodraSqliteDatabase | undefined;
let worker: TemporalWorkerHarness | undefined;
let app: Awaited<ReturnType<typeof createApp>> | undefined;

const invariant: (value: unknown, detail: string) => asserts value = (value, detail) => {
  if (!value) throw new Error(`${e2eLabel} invariant failed: ${detail}`);
};

const waitFor = async (predicate: () => boolean, detail: string): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Timed out waiting for ${detail}`);
};

const waitForAsync = async (predicate: () => Promise<boolean>, detail: string): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Timed out waiting for ${detail}`);
};

it.skipIf(!enabled)("runs the full I7 API to Temporal worker to provider vertical", async () => {
try {
  dataRoot = await realpath(await mkdtemp(join(tmpdir(), "nodra-i7-e2e-")));
  databaseFile = join(dataRoot, "nodra.db");
  server = await TemporalDevServer.start(dataRoot);
  runtime = new LazyTemporalConnection({
    address: server.address,
    namespace: server.namespace,
    connectTimeoutMs: 1_000
  });
  await waitForAsync(async () => (await runtime!.check()).status === "ok", "Temporal startup");

  const seed = NodraSqliteDatabase.open(databaseFile);
  await migrateDatabase(seed, migrationsDirectory);
  const seedCatalog = new SqliteProviderCatalogRepository(seed);
  if (deterministicProvider) {
    await saveDeterministicCatalog(seedCatalog, deterministicProvider);
  } else {
    await seedCatalog.save(await provider.probe());
  }
  seed.close();

  app = await createApp({
    databaseFile,
    migrationsDirectory,
    temporalAddress: server.address,
    temporalNamespace: server.namespace,
    dataRoot
  });

  workerDatabase = NodraSqliteDatabase.open(databaseFile);
  await migrateDatabase(workerDatabase, migrationsDirectory);
  const workspaceAdapter = new LocalWorkspaceAdapter(join(dataRoot, "workspaces"));
  await workspaceAdapter.initialize();
  const providerRuns = new SqliteProviderRunStore(workerDatabase);
  const permissions = new SqliteProviderPermissionHandler(
    new ManageConfirmations(new SqliteConfirmationRepository(workerDatabase), workspaceAdapter),
    providerRuns
  );
  worker = new TemporalWorkerHarness(
    server.address,
    server.namespace,
    resolve(root, "packages/adapters/src/temporal/workflows/mission-workflow.ts"),
    new TemporalRunActivities(
      new SqliteRunWorkflowActivity(workerDatabase),
      new ProviderRegistry([provider]),
      providerRuns,
      permissions,
      new SqliteProviderCatalogRepository(workerDatabase)
    )
  );

  const http = request(app.getHttpServer());
  process.stdout.write(`\n${e2eLabel}: API initialized\n`);
  const workspaceId = "i7-workspace";
  const missionWorkspace = join(dataRoot, "workspaces", "scratch");
  const workspaceResponse = await http.post("/api/workspaces").send({
    id: workspaceId,
    kind: "scratch",
    path: missionWorkspace,
    commandId: "i7-workspace-create"
  }).timeout({ response: 5_000, deadline: 10_000 });
  invariant(
    workspaceResponse.status === 201,
    `workspace API returned ${workspaceResponse.status}: ${JSON.stringify(workspaceResponse.body)}`
  );
  process.stdout.write(`${e2eLabel}: workspace created\n`);
  const created = await http.post("/api/missions").send({
    title: "I7 deterministic vertical",
    commandId: "i7-mission-create"
  }).expect(201);
  const missionId = created.body.id as string;
  process.stdout.write(`${e2eLabel}: mission created\n`);
  invariant(created.body.executionKind === "human", "title-only mission remains human");
  await http.post(`/api/missions/${missionId}/agent-config/enable`).send({
    expectedVersion: 0,
    commandId: "i7-enable"
  }).expect(201);
  await http.put(`/api/missions/${missionId}/agent-config`).set("If-Match", "\"0\"").send({
    providerId,
    modelId,
    reasoningEffort: "low",
    providerOptions: { schemaVersion: 1, value: {} },
    missionPrompt,
    permissionPreset: "read_only",
    workspaceId,
    autoCommitAuthorized: false,
    integrationTargetRef: null,
    commandId: "i7-configure"
  }).expect(200);

  const beforePreview = {
    executions: deterministicProvider?.executionCount ?? 0,
    runs: workerDatabase.orm.select().from(runs).all().length,
    outbox: workerDatabase.orm.select().from(outbox).all().length
  };
  const preview = await http.post(`/api/missions/${missionId}/agent-config/preview`).send({}).expect(201);
  invariant(preview.body.blockingErrors.length === 0, "preview resolves without blocking errors");
  invariant(preview.body.resolved.cwd === missionWorkspace, "preview exposes the canonical workspace path");
  if (deterministicProvider) {
    invariant(deterministicProvider.executionCount === beforePreview.executions, "preview performs no provider I/O");
  }
  invariant(workerDatabase.orm.select().from(runs).all().length === beforePreview.runs, "preview creates no run");
  invariant(workerDatabase.orm.select().from(outbox).all().length === beforePreview.outbox, "preview creates no outbox");

  const ready = await http.post(`/api/missions/${missionId}/ready`).send({
    expectedVersion: 1,
    commandId: "i7-ready"
  }).expect(201);
  const started = await http.post(`/api/missions/${missionId}/start`).send({
    expectedVersion: ready.body.version,
    commandId: "i7-start"
  }).expect(202);
  worker.start();
  process.stdout.write(`${e2eLabel}: worker initialized\n`);
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  const dispatch = await http.post("/api/runtime/temporal/dispatch").send({ limit: 10 });
  invariant(
    dispatch.status === 202,
    `dispatch API returned ${dispatch.status}: ${JSON.stringify(dispatch.body)}`
  );
  process.stdout.write(`${e2eLabel}: outbox dispatched\n`);
  await waitFor(
    () => workerDatabase!.orm.select().from(runs).where(eq(runs.id, started.body.runId)).get()?.state === "SUCCEEDED",
    "deterministic provider terminal state"
  );
  process.stdout.write(`${e2eLabel}: terminal persisted\n`);
  const terminalRun = workerDatabase.orm.select().from(runs).where(eq(runs.id, started.body.runId)).get();
  invariant(terminalRun?.state === "SUCCEEDED", "run terminal state is SUCCEEDED");
  const mission = workerDatabase.orm.select().from(missions).where(eq(missions.id, missionId)).get();
  invariant(mission?.state === "VALIDATION", "successful agent mission requires human validation");
  if (deterministicProvider) {
    invariant(deterministicProvider.executionCount === 1, "provider executes exactly once");
  }
  const eventCount = workerDatabase.orm.select().from(providerEvents)
    .where(eq(providerEvents.runId, started.body.runId)).all().length;
  invariant(
    deterministicProvider ? eventCount === 3 : eventCount >= 3,
    "provider events are persisted"
  );
  let markerPersisted = !realCodex;
  if (realCodex) {
    const run = workerDatabase.orm.select({ conversationId: runs.conversationId })
      .from(runs).where(eq(runs.id, started.body.runId)).get();
    const messages = run
      ? workerDatabase.orm.select({ body: conversationItems.body }).from(conversationItems)
          .where(eq(conversationItems.conversationId, run.conversationId)).all()
      : [];
    markerPersisted = messages.some(
      (message) => message.body?.includes("NODRA_I7_CODEX_OK") === true
    );
    invariant(
      markerPersisted,
      "real Codex result contains the explicit marker"
    );
  }
  if (deterministicProvider) {
    invariant(deterministicProvider.executionCount === 1, "published outbox executes the provider once");
  }
  invariant(
    workerDatabase.orm.select().from(outbox).where(eq(outbox.kind, "workflow.mission.start")).get()?.publishedAt,
    "workflow outbox is published"
  );

  process.stdout.write(JSON.stringify({
    status: "passed",
    missionId,
    runId: started.body.runId,
    runState: terminalRun.state,
    missionState: mission.state,
    provider: providerId,
    providerExecutions: deterministicProvider?.executionCount ?? "real_codex_single_run",
    eventCount,
    markerPersisted,
    cleanup: "pending"
  }, null, 2));
} finally {
  process.stdout.write(`\n${e2eLabel}: cleanup starting\n`);
  await app?.close().catch(() => undefined);
  process.stdout.write(`${e2eLabel}: API closed\n`);
  await worker?.forceCleanup();
  process.stdout.write(`${e2eLabel}: worker closed\n`);
  workerDatabase?.close();
  await runtime?.close();
  await server?.stop();
  await rm(dataRoot, { recursive: true, force: true });
  process.stdout.write(`\n${e2eLabel} cleanup complete\n`);
}
}, 120_000);
