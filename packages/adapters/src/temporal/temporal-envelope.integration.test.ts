import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DispatchWorkflowOutbox, GetHealth, StartMission, type RuntimeHealthProbe } from "@nodra/application";
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
        recordTerminal: activities.recordTerminal.bind(activities)
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
});
