import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DispatchWorkflowOutbox,
  GetHealth,
  ProviderProtocolIncompatibleError,
  ProviderRegistry,
  StartMission,
  type ProviderPort,
  type RuntimeHealthProbe
} from "@nodra/application";
import { asId } from "@nodra/domain";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDatabase } from "../sqlite/migrate-database.js";
import { NodraSqliteDatabase } from "../sqlite/nodra-sqlite-database.js";
import { SqliteHealthProbe } from "../sqlite/sqlite-health-probe.js";
import { SqliteMissionExecutionRepository } from "../sqlite/sqlite-mission-execution-repository.js";
import { SqliteMissionRepository } from "../sqlite/sqlite-mission-repository.js";
import { SqliteRunWorkflowActivity } from "../sqlite/sqlite-run-workflow-activity.js";
import { SqliteProviderCatalogRepository } from "../sqlite/sqlite-provider-catalog-repository.js";
import { SqliteProviderRunStore } from "../sqlite/sqlite-provider-run-store.js";
import type { SqliteProviderPermissionHandler } from "../sqlite/sqlite-provider-permission-handler.js";
import { providerEvents } from "../sqlite/schema/provider-events.js";
import { SqliteWorkflowOutboxStore } from "../sqlite/sqlite-workflow-outbox-store.js";
import { workspaces } from "../sqlite/schema/core.js";
import { conversations } from "../sqlite/schema/conversations.js";
import { missionAgentConfigs, missions } from "../sqlite/schema/missions.js";
import { businessAuditEvents, inbox, outbox, relayItems } from "../sqlite/schema/operations.js";
import { runConfigSnapshots, runs } from "../sqlite/schema/runs.js";
import { TemporalRunActivities } from "./activities/temporal-run-activities.js";
import type { MissionWorkflowStatus } from "./contracts.js";
import { LazyTemporalConnection } from "./client/lazy-temporal-connection.js";
import { TemporalWorkflowAdapter } from "./client/temporal-workflow-adapter.js";
import { MISSION_TASK_QUEUE } from "./temporal-settings.js";

const workflowsPath = resolve("packages/adapters/src/temporal/workflows/mission-workflow.ts");
const now = "2026-07-22T12:00:00.000Z";

describe.sequential("Temporal durable envelope", () => {
  let environment: TestWorkflowEnvironment;
  let database: NodraSqliteDatabase;
  let existingRuntime: LazyTemporalConnection;

  beforeAll(async () => {
    environment = await TestWorkflowEnvironment.createLocal();
    existingRuntime = new LazyTemporalConnection({
      address: environment.address,
      namespace: "default",
      connectTimeoutMs: 1_000
    });
    const directory = await mkdtemp(join(tmpdir(), "nodra-i3-temporal-"));
    database = NodraSqliteDatabase.open(join(directory, "nodra.db"));
    await migrateDatabase(database, resolve("packages/adapters/drizzle"));
  }, 120_000);

  afterAll(async () => {
    database.close();
    await existingRuntime.close();
    await environment.teardown();
  });

  const seed = (missionId: string) => {
    database.orm.insert(workspaces).values({
      id: `workspace-${missionId}`,
      projectId: null,
      kind: "scratch",
      path: join(tmpdir(), `workspace-${missionId}`),
      state: "ready",
      createdAt: now
    }).run();
    database.orm.insert(missions).values({
      id: missionId,
      projectId: null,
      title: `Temporal ${missionId}`,
      executionKind: "agent",
      state: "READY",
      version: 1,
      createdAt: now,
      updatedAt: now
    }).run();
    database.orm.insert(missionAgentConfigs).values({
      missionId,
      providerId: "configured-not-called",
      modelId: "configured-not-called",
      providerOptionsJson: "{}",
      missionPrompt: "No provider invocation",
      permissionPreset: "read_only",
      workspaceId: `workspace-${missionId}`,
      updatedAt: now
    }).run();
  };

  const persistStart = async (missionId: string, runtime: RuntimeHealthProbe = existingRuntime) => {
    const commandId = `command-${missionId}`;
    await new StartMission(
      new SqliteMissionRepository(database),
      new SqliteMissionExecutionRepository(database),
      runtime
    ).execute({
      missionId: asId(missionId),
      expectedVersion: 1,
      runId: asId(`run-${missionId}`),
      conversationId: asId(`conversation-${missionId}`),
      auditId: asId(`audit-${missionId}`),
      outboxId: asId(`outbox-${missionId}`),
      context: { commandId: asId(commandId), actor: "user", occurredAt: now }
    });
  };

  const createWorker = async () => {
    const activities = new TemporalRunActivities(new SqliteRunWorkflowActivity(database));
    return Worker.create({
      connection: environment.nativeConnection,
      namespace: "default",
      taskQueue: MISSION_TASK_QUEUE,
      workflowsPath,
      activities: {
        recordStarted: activities.recordStarted.bind(activities),
        recordTerminal: activities.recordTerminal.bind(activities),
        executeProvider: activities.executeProvider.bind(activities),
        steerProvider: activities.steerProvider.bind(activities)
      }
    });
  };

  const waitUntilStarted = async (adapter: TemporalWorkflowAdapter, workflowId: string) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const status = await adapter.query<MissionWorkflowStatus>(workflowId, { type: "status" });
      if (status.phase === "started") return status;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }
    throw new Error(`Workflow ${workflowId} did not reach started`);
  };

  const waitUntilRunRecorded = async (runId: string) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const run = database.orm.select().from(runs).where(eq(runs.id, runId)).get();
      if (run?.state === "STARTING" && run.temporalRunId) return run;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }
    throw new Error(`Run ${runId} was not recorded by its child Workflow`);
  };

  it("checks both server and namespace and blocks start atomically for a missing namespace", async () => {
    await expect(existingRuntime.check()).resolves.toEqual({ status: "ok" });
    const missingRuntime = new LazyTemporalConnection({
      address: environment.address,
      namespace: "namespace-that-does-not-exist",
      connectTimeoutMs: 1_000
    });
    try {
      await expect(missingRuntime.check()).resolves.toEqual({
        status: "error",
        detail: "Temporal runtime is unavailable"
      });
      await expect(new GetHealth(new SqliteHealthProbe(database), missingRuntime).execute()).resolves.toMatchObject({
        status: "degraded",
        components: { sqlite: { status: "ok" }, workflow: { status: "error" } }
      });

      seed("missing-namespace");
      await expect(persistStart("missing-namespace", missingRuntime)).rejects.toMatchObject({
        code: "RUNTIME_UNHEALTHY"
      });
      expect(database.orm.select().from(missions).where(eq(missions.id, "missing-namespace")).get())
        .toMatchObject({ state: "READY", version: 1, temporalParentWorkflowId: null });
      expect(database.orm.select().from(conversations).all()).toHaveLength(0);
      expect(database.orm.select().from(runs).all()).toHaveLength(0);
      expect(database.orm.select().from(runConfigSnapshots).all()).toHaveLength(0);
      expect(database.orm.select().from(businessAuditEvents).all()).toHaveLength(0);
      expect(database.orm.select().from(relayItems).all()).toHaveLength(0);
      expect(database.orm.select().from(outbox).all()).toHaveLength(0);
    } finally {
      await missingRuntime.close();
    }
  });

  it("deduplicates first dispatch, redispatch after success and crash recovery, then replays after worker restart", async () => {
    const adapter = new TemporalWorkflowAdapter(environment.client.workflow);
    const store = new SqliteWorkflowOutboxStore(database);

    seed("normal");
    await persistStart("normal");
    const firstWorker = await createWorker();
    await firstWorker.runUntil(async () => {
      await expect(new DispatchWorkflowOutbox(store, adapter).execute({ limit: 10, occurredAt: now }))
        .resolves.toMatchObject({ accepted: 1 });
      await expect(waitUntilStarted(adapter, "mission/normal")).resolves.toMatchObject({
        phase: "started",
        missionId: "normal",
        runId: "run-normal",
        childWorkflowId: "run/run-normal",
        schemaVersion: 1
      });
      await waitUntilRunRecorded("run-normal");
    });
    const normalParent = await environment.client.workflow.getHandle("mission/normal").describe();
    const normalChild = await environment.client.workflow.getHandle("run/run-normal").describe();
    expect(normalChild.parentExecution?.workflowId).toBe("mission/normal");
    expect(database.orm.select().from(runs).where(eq(runs.id, "run-normal")).get()?.temporalRunId)
      .toBe(normalChild.runId);
    expect(database.orm.select().from(outbox).where(eq(outbox.id, "outbox-normal")).get()?.publishedAt).toBe(now);
    await expect(new DispatchWorkflowOutbox(store, adapter).execute({ limit: 10, occurredAt: now }))
      .resolves.toEqual({ accepted: 0, messageIds: [] });

    seed("crash");
    await persistStart("crash");
    const crashingDispatcher = new DispatchWorkflowOutbox(store, adapter, {
      accepted: async () => { throw new Error("simulated crash after Temporal start"); }
    });
    await expect(crashingDispatcher.execute({ limit: 10, occurredAt: now }))
      .rejects.toThrow("simulated crash after Temporal start");
    expect(database.orm.select().from(outbox).where(eq(outbox.id, "outbox-crash")).get()?.publishedAt).toBeNull();
    const runIdBeforeRecovery = (await environment.client.workflow.getHandle("mission/crash").describe()).runId;

    const recoveryWorker = await createWorker();
    await recoveryWorker.runUntil(async () => {
      await expect(new DispatchWorkflowOutbox(store, adapter).execute({ limit: 10, occurredAt: now }))
        .resolves.toMatchObject({ accepted: 1 });
      await waitUntilStarted(adapter, "mission/crash");
      await waitUntilRunRecorded("run-crash");
    });
    const runIdAfterRecovery = (await environment.client.workflow.getHandle("mission/crash").describe()).runId;
    expect(runIdAfterRecovery).toBe(runIdBeforeRecovery);
    const crashChildBeforeRestart = await environment.client.workflow.getHandle("run/run-crash").describe();
    expect(crashChildBeforeRestart.parentExecution?.workflowId).toBe("mission/crash");
    expect(database.orm.select().from(runs).where(eq(runs.id, "run-crash")).get()?.temporalRunId)
      .toBe(crashChildBeforeRestart.runId);
    expect(database.orm.select().from(outbox).where(eq(outbox.id, "outbox-crash")).get()?.publishedAt).toBe(now);
    expect(database.orm.select().from(inbox).all()).toHaveLength(2);

    const restartedWorker = await createWorker();
    await restartedWorker.runUntil(async () => {
      await expect(waitUntilStarted(adapter, "mission/crash")).resolves.toMatchObject({ phase: "started" });
      await adapter.signal("mission/crash", { type: "cancel" });
      await environment.client.workflow.getHandle("mission/crash").result();
      await adapter.signal("mission/normal", { type: "cancel" });
      await environment.client.workflow.getHandle("mission/normal").result();
    });

    expect((await environment.client.workflow.getHandle("run/run-crash").describe()).status.name).toBe("CANCELLED");
    expect((await environment.client.workflow.getHandle("run/run-normal").describe()).status.name).toBe("CANCELLED");
    expect((await environment.client.workflow.getHandle("run/run-crash").describe()).runId)
      .toBe(crashChildBeforeRestart.runId);

    const parentHistory = await environment.client.workflow.getHandle("mission/crash").fetchHistory();
    const childHistory = await environment.client.workflow.getHandle("run/run-crash").fetchHistory();
    await expect(Worker.runReplayHistory({ workflowsPath }, parentHistory, "mission/crash")).resolves.toBeUndefined();
    await expect(Worker.runReplayHistory({ workflowsPath }, childHistory, "run/run-crash")).resolves.toBeUndefined();
    expect(database.orm.select().from(inbox).all()).toHaveLength(4);
    expect(database.orm.select().from(runs).where(eq(runs.id, "run-crash")).get())
      .toMatchObject({ state: "CANCELLED" });
    expect(database.orm.select().from(runs).where(eq(runs.id, "run-normal")).get())
      .toMatchObject({ state: "CANCELLED" });
    expect(database.orm.select().from(workspaces).where(eq(workspaces.id, "workspace-crash")).get())
      .toMatchObject({ state: "ready" });
    expect(database.orm.select().from(workspaces).where(eq(workspaces.id, "workspace-normal")).get())
      .toMatchObject({ state: "ready" });
    expect(normalParent.workflowId).toBe("mission/normal");
  }, 120_000);

  it("runs a real provider Activity envelope and projects its persisted session, events, result and reported usage", async () => {
    const missionId = "provider-success";
    const incompatibleMissionId = "provider-incompatible";
    seed(missionId);
    seed(incompatibleMissionId);
    for (const configuredMissionId of [missionId, incompatibleMissionId]) {
      database.orm.update(missionAgentConfigs).set({
        providerId: "codex",
        modelId: "model-1",
        reasoningEffort: "medium",
        missionPrompt: "fixture provider work",
        permissionPreset: "workspace"
      }).where(eq(missionAgentConfigs.missionId, configuredMissionId)).run();
    }
    const catalog = new SqliteProviderCatalogRepository(database);
    const available = { available: true, reason: null };
    await catalog.save({
      providerId: "codex",
      adapterVersion: "fixture-v1",
      binaryVersion: "codex_cli_rs/0.145.0",
      authenticated: true,
      authKind: "chatgpt",
      health: { status: "ready", reason: null, actionRequired: null },
      capabilities: {
        schemaVersion: 1,
        providerId: "codex",
        version: "fixture-v1",
        availability: available,
        authentication: available,
        models: available,
        contract: {
          ...available,
          status: "certified",
          expectedVersion: "fixture-v1",
          currentVersion: "fixture-v1",
          action: null
        },
        start: available,
        events: available,
        cancel: available,
        resume: available,
        steer: { ...available, mode: "immediate" },
        usage: {
          available: false,
          reason: "usage_not_observed_by_explicit_probe",
          kind: "none"
        },
        attachments: { available: false, reason: "not_fixture_proven" },
        mcp: { available: false, reason: "not_fixture_proven" },
        permissionInterception: available,
        optionsSchemaVersion: 1
      },
      models: [{
        id: "model-1",
        displayName: "Model One",
        description: "fixture",
        hidden: false,
        isDefault: true,
        supportedReasoningEfforts: ["medium"],
        defaultReasoningEffort: "medium"
      }],
      probedAt: "2026-07-22T12:01:00.000Z"
    });
    await new StartMission(
      new SqliteMissionRepository(database),
      new SqliteMissionExecutionRepository(database),
      existingRuntime,
      catalog
    ).execute({
      missionId: asId(missionId),
      expectedVersion: 1,
      runId: asId(`run-${missionId}`),
      conversationId: asId(`conversation-${missionId}`),
      auditId: asId(`audit-${missionId}`),
      outboxId: asId(`outbox-${missionId}`),
      context: { commandId: asId(`command-${missionId}`), actor: "user", occurredAt: now }
    });
    await new StartMission(
      new SqliteMissionRepository(database),
      new SqliteMissionExecutionRepository(database),
      existingRuntime,
      catalog
    ).execute({
      missionId: asId(incompatibleMissionId),
      expectedVersion: 1,
      runId: asId(`run-${incompatibleMissionId}`),
      conversationId: asId(`conversation-${incompatibleMissionId}`),
      auditId: asId(`audit-${incompatibleMissionId}`),
      outboxId: asId(`outbox-${incompatibleMissionId}`),
      context: {
        commandId: asId(`command-${incompatibleMissionId}`),
        actor: "user",
        occurredAt: now
      }
    });
    const provider: ProviderPort = {
      providerId: "codex",
      probe: async () => { throw new Error("probe must remain opt-in"); },
      cancel: async () => undefined,
      steer: async () => undefined,
      execute: async (configuration, sink) => {
        if (configuration.runId === `run-${incompatibleMissionId}`) {
          await sink.event({
            type: "provider/protocolIncompatible",
            payload: {
              code: "protocol_incompatible",
              reason: "fixture_terminal_shape"
            },
            occurredAt: "2026-07-22T12:01:30.000Z"
          });
          throw new ProviderProtocolIncompatibleError(
            "fixture_terminal_shape",
            "codex",
            "codex_cli_rs/0.146.0"
          );
        }
        await sink.session("thr_integration");
        await sink.runRef("turn_integration");
        await sink.event({
          type: "turn/started",
          payload: { turn: { id: "turn_integration", status: "inProgress" } },
          occurredAt: "2026-07-22T12:02:00.000Z"
        });
        await sink.event({
          type: "thread/tokenUsage/updated",
          payload: {
            tokenUsage: {
              total: {
                inputTokens: 12,
                outputTokens: 4,
                cachedInputTokens: 3,
                cacheWriteInputTokens: 0
              }
            }
          },
          occurredAt: "2026-07-22T12:02:01.000Z"
        });
        await sink.event({
          type: "item/completed",
          payload: { item: { id: "answer-1", type: "agentMessage", text: "finished" } },
          occurredAt: "2026-07-22T12:02:02.000Z"
        });
        await sink.event({
          type: "turn/completed",
          payload: { turn: { id: "turn_integration", status: "completed" } },
          occurredAt: "2026-07-22T12:02:03.000Z"
        });
        return {
          state: "SUCCEEDED",
          externalSessionId: "thr_integration",
          externalRunId: "turn_integration"
        };
      }
    };
    const providerRuns = new SqliteProviderRunStore(database);
    const activities = new TemporalRunActivities(
      new SqliteRunWorkflowActivity(database),
      new ProviderRegistry([provider]),
      providerRuns,
      {} as SqliteProviderPermissionHandler,
      catalog
    );
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      namespace: "default",
      taskQueue: MISSION_TASK_QUEUE,
      workflowsPath,
      activities: {
        recordStarted: activities.recordStarted.bind(activities),
        recordTerminal: activities.recordTerminal.bind(activities),
        executeProvider: activities.executeProvider.bind(activities),
        steerProvider: activities.steerProvider.bind(activities)
      }
    });
    const adapter = new TemporalWorkflowAdapter(environment.client.workflow);
    await worker.runUntil(async () => {
      await new DispatchWorkflowOutbox(new SqliteWorkflowOutboxStore(database), adapter)
        .execute({ limit: 10, occurredAt: now });
      await Promise.all([
        environment.client.workflow.getHandle(`mission/${missionId}`).result(),
        environment.client.workflow.getHandle(`mission/${incompatibleMissionId}`).result()
      ]);
    });

    expect(database.orm.select().from(conversations)
      .where(eq(conversations.id, `conversation-${missionId}`)).get()).toMatchObject({
      providerSessionRef: "thr_integration"
    });
    expect(database.orm.select().from(runs).where(eq(runs.id, `run-${missionId}`)).get()).toMatchObject({
      state: "SUCCEEDED",
      providerRunRef: "turn_integration",
      usageKind: "reported",
      inputTokens: 12,
      outputTokens: 4,
      cacheReadTokens: 3,
      cacheWriteTokens: 0
    });
    expect(database.orm.select().from(providerEvents)
      .where(eq(providerEvents.runId, `run-${missionId}`)).all().map((event) => event.sequence))
      .toEqual([0, 1, 2, 3]);
    expect(database.orm.select().from(workspaces)
      .where(eq(workspaces.id, `workspace-${missionId}`)).get()).toMatchObject({ state: "ready" });
    expect(database.orm.select().from(runs)
      .where(eq(runs.id, `run-${incompatibleMissionId}`)).get()).toMatchObject({
      state: "FAILED"
    });
    expect(database.orm.select().from(providerEvents)
      .where(eq(providerEvents.runId, `run-${incompatibleMissionId}`)).all()).toHaveLength(1);
    expect((await catalog.latest("codex"))?.health).toEqual({
      status: "degraded",
      reason: "protocol_incompatible",
      actionRequired: "update_required"
    });
  }, 120_000);
});
