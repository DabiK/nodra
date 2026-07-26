import { access, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import request from "supertest";
import { eq } from "drizzle-orm";
import { it } from "vitest";
import {
  LazyTemporalConnection,
  LocalWorkspaceAdapter,
  migrateDatabase,
  NodraSqliteDatabase,
  OpenCodeProviderAdapter,
  SqliteConfirmationRepository,
  SqliteProviderCatalogRepository,
  SqliteProviderPermissionHandler,
  SqliteProviderRunStore,
  SqliteRunWorkflowActivity,
  TemporalRunActivities
} from "@nodra/adapters";
import { ManageConfirmations, ProviderRegistry } from "@nodra/application";
import { createApp } from "./src/create-app.js";
import { conversationItems } from "../../packages/adapters/src/sqlite/schema/conversations.js";
import { missions } from "../../packages/adapters/src/sqlite/schema/missions.js";
import { providerEvents } from "../../packages/adapters/src/sqlite/schema/provider-events.js";
import { runs } from "../../packages/adapters/src/sqlite/schema/runs.js";
import { OpenCodeTestServer } from "../../poc/opencode/opencode-test-server.js";
import { TemporalDevServer } from "../../poc/temporal/temporal-dev-server.js";
import { TemporalWorkerHarness } from "../../poc/temporal/temporal-worker-harness.js";

const enabled = process.env.NODRA_TEST_REAL_OPENCODE_I8 === "1"
  && process.env.NODRA_I8_PROVIDER === "opencode";
const marker = "NODRA_I8_OPENCODE_OK";
const internalProfile = process.env.NODRA_I8_INTERNAL_PROFILE === "zen" ? "zen" : "ollama";
const internalModel = internalProfile === "zen"
  ? "opencode/deepseek-v4-flash-free"
  : "ollama/gemma3:4b";
const reasoningEffort = internalProfile === "zen" ? "high" : "provider_default";

it.skipIf(!enabled)(
  "runs API to Temporal to OpenCode Serve to the selected isolated model exactly once",
  async () => {
    let dataRoot = "";
    let app: Awaited<ReturnType<typeof createApp>> | undefined;
    let temporal: TemporalDevServer | undefined;
    let runtime: LazyTemporalConnection | undefined;
    let openCode: OpenCodeTestServer | undefined;
    let workerDatabase: NodraSqliteDatabase | undefined;
    let worker: TemporalWorkerHarness | undefined;
    try {
      await access(process.env.NODRA_OPENCODE_BINARY ?? "/Users/Dabi/.opencode/bin/opencode");
      if (internalProfile === "ollama") {
        const ollama = await fetch("http://127.0.0.1:11434/api/tags");
        if (!ollama.ok) throw new Error(`Ollama prerequisite failed with HTTP ${ollama.status}`);
        const tags: unknown = await ollama.json();
        if (
          !isRecord(tags)
          || !Array.isArray(tags.models)
          || !tags.models.some((value) => isRecord(value) && value.name === "gemma3:4b")
        ) {
          throw new Error("Ollama prerequisite gemma3:4b is missing");
        }
      }

      dataRoot = await realpath(await mkdtemp(join(tmpdir(), "nodra-i8-e2e-")));
      temporal = await TemporalDevServer.start(dataRoot);
      runtime = new LazyTemporalConnection({
        address: temporal.address,
        namespace: temporal.namespace,
        connectTimeoutMs: 1_000
      });
      openCode = await OpenCodeTestServer.start(dataRoot, internalProfile);
      const adapter = new OpenCodeProviderAdapter({ baseUrl: openCode.baseUrl });
      const databaseFile = join(dataRoot, "nodra.db");
      const migrationsDirectory = resolve("packages/adapters/drizzle");
      const seed = NodraSqliteDatabase.open(databaseFile);
      await migrateDatabase(seed, migrationsDirectory);
      const catalog = new SqliteProviderCatalogRepository(seed);
      const probe = await catalog.save(await adapter.probe());
      if (!probe.capabilities.start.available) {
        throw new Error(`OpenCode start capability unavailable: ${probe.capabilities.start.reason}`);
      }
      const selectedModel = probe.models.find((model) => model.id === internalModel);
      if (!selectedModel) {
        throw new Error(`OpenCode catalog did not expose ${internalModel}`);
      }
      if (!selectedModel.supportedReasoningEfforts.includes(reasoningEffort)) {
        throw new Error(
          `OpenCode catalog did not expose effort ${reasoningEffort} for ${internalModel}`
        );
      }
      seed.close();

      app = await createApp({
        databaseFile,
        migrationsDirectory,
        temporalAddress: temporal.address,
        temporalNamespace: temporal.namespace,
        dataRoot,
        opencodeBaseUrl: openCode.baseUrl
      });
      workerDatabase = NodraSqliteDatabase.open(databaseFile);
      await migrateDatabase(workerDatabase, migrationsDirectory);
      const workspaceAdapter = new LocalWorkspaceAdapter(join(dataRoot, "workspaces"));
      await workspaceAdapter.initialize();
      const providerRuns = new SqliteProviderRunStore(workerDatabase);
      const permissions = new SqliteProviderPermissionHandler(
        new ManageConfirmations(
          new SqliteConfirmationRepository(workerDatabase),
          workspaceAdapter
        ),
        providerRuns
      );
      worker = new TemporalWorkerHarness(
        temporal.address,
        temporal.namespace,
        resolve("packages/adapters/src/temporal/workflows/mission-workflow.ts"),
        new TemporalRunActivities(
          new SqliteRunWorkflowActivity(workerDatabase),
          new ProviderRegistry([adapter]),
          providerRuns,
          permissions,
          new SqliteProviderCatalogRepository(workerDatabase)
        )
      );
      worker.start();

      const http = request(app.getHttpServer());
      const workspaceId = "i8-workspace";
      const workspacePath = join(dataRoot, "workspaces", "scratch");
      await http.post("/api/workspaces").send({
        id: workspaceId,
        kind: "scratch",
        path: workspacePath,
        commandId: "i8-workspace"
      }).expect(201);
      const created = await http.post("/api/missions").send({
        title: "I8 OpenCode Serve Ollama",
        commandId: "i8-create"
      }).expect(201);
      const missionId = String(created.body.id);
      await http.post(`/api/missions/${missionId}/agent-config/enable`).send({
        expectedVersion: 0,
        commandId: "i8-enable"
      }).expect(201);
      await http.put(`/api/missions/${missionId}/agent-config`)
        .set("If-Match", "\"0\"")
        .send({
          providerId: "opencode",
          modelId: internalModel,
          reasoningEffort,
          providerOptions: { schemaVersion: 1, value: {} },
          missionPrompt: `Reply with exactly ${marker}. Do not use tools.`,
          permissionPreset: "read_only",
          workspaceId,
          autoCommitAuthorized: false,
          integrationTargetRef: null,
          commandId: "i8-config"
        })
        .expect(200);
      const preview = await http
        .post(`/api/missions/${missionId}/agent-config/preview`)
        .send({})
        .expect(201);
      invariant(preview.body.resolved.providerId === "opencode", "preview provider is opencode");
      invariant(preview.body.blockingErrors.length === 0, "preview has no blocking errors");
      const ready = await http.post(`/api/missions/${missionId}/ready`).send({
        expectedVersion: 1,
        commandId: "i8-ready"
      }).expect(201);
      const started = await http.post(`/api/missions/${missionId}/start`).send({
        expectedVersion: ready.body.version,
        commandId: "i8-start"
      }).expect(202);
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
      await http.post("/api/runtime/temporal/dispatch").send({ limit: 10 }).expect(202);
      await waitFor(() => {
        const state = workerDatabase!.orm.select().from(runs)
          .where(eq(runs.id, started.body.runId)).get()?.state;
        return state !== undefined && ["SUCCEEDED", "FAILED", "CANCELLED"].includes(state);
      });

      const terminalRun = workerDatabase.orm.select().from(runs)
        .where(eq(runs.id, started.body.runId)).get();
      const mission = workerDatabase.orm.select().from(missions)
        .where(eq(missions.id, missionId)).get();
      const eventCount = workerDatabase.orm.select().from(providerEvents)
        .where(eq(providerEvents.runId, started.body.runId)).all().length;
      const conversation = terminalRun
        ? workerDatabase.orm.select({ conversationId: runs.conversationId }).from(runs)
            .where(eq(runs.id, terminalRun.id)).get()
        : null;
      const messages = conversation
        ? workerDatabase.orm.select().from(conversationItems)
            .where(eq(conversationItems.conversationId, conversation.conversationId)).all()
        : [];
      const markerPersisted = messages.some((message) => message.body?.includes(marker));
      invariant(terminalRun?.state === "SUCCEEDED", "run is SUCCEEDED");
      invariant(mission?.state === "VALIDATION", "mission is VALIDATION");
      invariant(markerPersisted, "assistant marker is persisted");
      process.stdout.write(`\n${JSON.stringify({
        status: "passed",
        providerId: "opencode",
        internalProviderId: internalModel.split("/", 1)[0],
        internalModel,
        reasoningEffort,
        runId: started.body.runId,
        missionId,
        runState: terminalRun.state,
        missionState: mission.state,
        eventCount,
        markerPersisted,
        cleanup: "pending"
      }, null, 2)}\n`);
    } catch (error) {
      if (workerDatabase) {
        process.stdout.write(`I8 failure snapshot: ${JSON.stringify({
          runs: workerDatabase.orm.select().from(runs).all().map((run) => ({
            id: run.id,
            state: run.state,
            providerId: run.providerId,
            modelId: run.modelId
          })),
          events: workerDatabase.orm.select().from(providerEvents).all().map((event) => ({
            runId: event.runId,
            sequence: event.sequence,
            type: event.type,
            payload: JSON.parse(event.payloadJson)
          }))
        }, null, 2)}\n`);
      }
      if (openCode) process.stdout.write(`OpenCode diagnostic:\n${openCode.diagnostic()}\n`);
      throw error;
    } finally {
      await app?.close().catch(() => undefined);
      await worker?.forceCleanup();
      workerDatabase?.close();
      await runtime?.close();
      await temporal?.stop();
      await openCode?.stop();
      if (dataRoot) await rm(dataRoot, { recursive: true, force: true });
      process.stdout.write("I8 cleanup complete\n");
    }
  },
  180_000
);

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Timed out waiting for the OpenCode I8 terminal run");
};

const invariant: (value: unknown, detail: string) => asserts value = (value, detail) => {
  if (!value) throw new Error(`I8 E2E invariant failed: ${detail}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
