import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DispatchWorkflowOutbox, StartMission } from "@nodra/application";
import { asId } from "@nodra/domain";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDatabase } from "../sqlite/migrate-database.js";
import { NodraSqliteDatabase } from "../sqlite/nodra-sqlite-database.js";
import { SqliteMissionExecutionRepository } from "../sqlite/sqlite-mission-execution-repository.js";
import { SqliteMissionRepository } from "../sqlite/sqlite-mission-repository.js";
import { SqliteMissionWorkflowActivity } from "../sqlite/sqlite-mission-workflow-activity.js";
import { SqliteWorkflowOutboxStore } from "../sqlite/sqlite-workflow-outbox-store.js";
import { workspaces } from "../sqlite/schema/core.js";
import { missionAgentConfigs, missions } from "../sqlite/schema/missions.js";
import { inbox, outbox } from "../sqlite/schema/operations.js";
import { TemporalMissionActivities } from "./activities/temporal-mission-activities.js";
import type { MissionWorkflowStatus } from "./contracts.js";
import { TemporalWorkflowAdapter } from "./client/temporal-workflow-adapter.js";
import { MISSION_TASK_QUEUE } from "./temporal-settings.js";

const workflowsPath = resolve("packages/adapters/src/temporal/workflows/mission-workflow.ts");
const now = "2026-07-22T12:00:00.000Z";

describe.sequential("Temporal durable envelope", () => {
  let environment: TestWorkflowEnvironment;
  let database: NodraSqliteDatabase;

  beforeAll(async () => {
    environment = await TestWorkflowEnvironment.createLocal();
    const directory = await mkdtemp(join(tmpdir(), "nodra-i3-temporal-"));
    database = NodraSqliteDatabase.open(join(directory, "nodra.db"));
    await migrateDatabase(database, resolve("packages/adapters/drizzle"));
  }, 120_000);

  afterAll(async () => {
    database.close();
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

  const persistStart = async (missionId: string) => {
    const commandId = `command-${missionId}`;
    await new StartMission(
      new SqliteMissionRepository(database),
      new SqliteMissionExecutionRepository(database),
      { check: async () => ({ status: "ok" }) }
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
    const activities = new TemporalMissionActivities(new SqliteMissionWorkflowActivity(database));
    return Worker.create({
      connection: environment.nativeConnection,
      namespace: "default",
      taskQueue: MISSION_TASK_QUEUE,
      workflowsPath,
      activities: { recordStarted: activities.recordStarted.bind(activities) }
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
        schemaVersion: 1
      });
    });
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
    });
    const runIdAfterRecovery = (await environment.client.workflow.getHandle("mission/crash").describe()).runId;
    expect(runIdAfterRecovery).toBe(runIdBeforeRecovery);
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

    const history = await environment.client.workflow.getHandle("mission/crash").fetchHistory();
    await expect(Worker.runReplayHistory({ workflowsPath }, history, "mission/crash")).resolves.toBeUndefined();
    expect(database.orm.select().from(inbox).all()).toHaveLength(2);
  }, 120_000);
});
