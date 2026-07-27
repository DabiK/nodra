import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { StartMission } from "@nodra/application";
import { asId } from "@nodra/domain";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrate-database.js";
import { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { SqliteMissionExecutionRepository } from "./sqlite-mission-execution-repository.js";
import { SqliteMissionRepository } from "./sqlite-mission-repository.js";
import { SqliteRunWorkflowActivity } from "./sqlite-run-workflow-activity.js";
import { SqliteWorkflowOutboxStore } from "./sqlite-workflow-outbox-store.js";
import { workspaces } from "./schema/core.js";
import { conversations } from "./schema/conversations.js";
import { missionAgentConfigs, missions } from "./schema/missions.js";
import { businessAuditEvents, inbox, outbox, relayItems } from "./schema/operations.js";
import { runConfigSnapshots, runs } from "./schema/runs.js";

const now = "2026-07-22T10:00:00.000Z";

describe("SqliteMissionExecutionRepository", () => {
  let database: NodraSqliteDatabase;

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-i3-sqlite-"));
    database = NodraSqliteDatabase.open(join(directory, "nodra.db"));
    await migrateDatabase(database, resolve("packages/adapters/drizzle"));
  });

  afterEach(() => database.close());

  const seedReadyAgent = (missionId = "mission-agent") => {
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
      title: "Durable mission",
      executionKind: "agent",
      state: "READY",
      version: 1,
      createdAt: now,
      updatedAt: now
    }).run();
    database.orm.insert(missionAgentConfigs).values({
      missionId,
      providerId: "provider-configured-not-invoked",
      modelId: "model-configured-not-invoked",
      providerOptionsSchemaVersion: 1,
      providerOptionsJson: "{}",
      missionPrompt: "Persisted prompt",
      permissionPreset: "read_only",
      workspaceId: `workspace-${missionId}`,
      autoCommitAuthorized: 0,
      updatedAt: now
    }).run();
  };

  const executeStart = (missionId = "mission-agent", commandId = "command-start") => {
    const repository = new SqliteMissionRepository(database);
    return new StartMission(repository, new SqliteMissionExecutionRepository(database), {
      check: async () => ({ status: "ok" })
    }).execute({
      missionId: asId(missionId),
      expectedVersion: 1,
      runId: asId(`run-${missionId}`),
      conversationId: asId(`conversation-${missionId}`),
      auditId: asId(`audit-${commandId}`),
      outboxId: asId(`outbox-${commandId}`),
      context: { commandId: asId(commandId), actor: "user", occurredAt: now }
    });
  };

  it("atomically persists mission, conversation, run, snapshot, audit, Relay and unpublished outbox", async () => {
    seedReadyAgent();
    await executeStart();
    expect(database.orm.select().from(missions).where(eq(missions.id, "mission-agent")).get())
      .toMatchObject({ state: "ACTIVE", version: 2, temporalParentWorkflowId: "mission/mission-agent/run/run-mission-agent" });
    expect(database.orm.select().from(conversations).all()).toHaveLength(1);
    expect(database.orm.select().from(runs).all()).toEqual([
      expect.objectContaining({ id: "run-mission-agent", state: "QUEUED", temporalWorkflowId: "run/run-mission-agent" })
    ]);
    expect(database.orm.select().from(runConfigSnapshots).all()).toEqual([
      expect.objectContaining({ runId: "run-mission-agent", cwd: join(tmpdir(), "workspace-mission-agent") })
    ]);
    expect(database.orm.select().from(businessAuditEvents).where(eq(businessAuditEvents.commandId, "command-start")).all())
      .toHaveLength(2);
    expect(database.orm.select().from(workspaces).where(eq(workspaces.id, "workspace-mission-agent")).get())
      .toMatchObject({ state: "in_use" });
    expect(database.orm.select().from(outbox).where(eq(outbox.kind, "workflow.mission.start")).all())
      .toEqual([expect.objectContaining({ dedupeKey: "mission/mission-agent/run/run-mission-agent", publishedAt: null })]);
    expect(database.orm.select().from(relayItems).where(eq(relayItems.missionId, "mission-agent")).get())
      .toMatchObject({ queue: "active", reasonCode: "workflow_dispatch_pending" });
  });

  it("rolls the whole start back when the command id is already consumed", async () => {
    seedReadyAgent();
    database.orm.insert(businessAuditEvents).values({
      id: "existing-audit",
      aggregateKind: "mission",
      aggregateId: "other",
      commandId: "duplicate-command",
      eventType: "EXISTING",
      actor: "user",
      payloadJson: "{}",
      occurredAt: now
    }).run();
    await expect(executeStart("mission-agent", "duplicate-command")).rejects.toMatchObject({
      code: "COMMAND_ID_CONFLICT"
    });
    expect(database.orm.select().from(missions).where(eq(missions.id, "mission-agent")).get())
      .toMatchObject({ state: "READY", version: 1, temporalParentWorkflowId: null });
    expect(database.orm.select().from(conversations).all()).toHaveLength(0);
    expect(database.orm.select().from(runs).all()).toHaveLength(0);
    expect(database.orm.select().from(runConfigSnapshots).all()).toHaveLength(0);
    expect(database.orm.select().from(outbox).where(eq(outbox.kind, "workflow.mission.start")).all()).toHaveLength(0);
    expect(database.orm.select().from(workspaces).where(eq(workspaces.id, "workspace-mission-agent")).get())
      .toMatchObject({ state: "ready" });
  });

  it("prioritizes missing persisted configuration before runtime health", async () => {
    database.orm.insert(missions).values({
      id: "mission-unconfigured",
      projectId: null,
      title: "Unconfigured",
      executionKind: "agent",
      state: "READY",
      version: 1,
      createdAt: now,
      updatedAt: now
    }).run();
    const start = new StartMission(
      new SqliteMissionRepository(database),
      new SqliteMissionExecutionRepository(database),
      { check: async () => ({ status: "error" }) }
    );
    await expect(start.execute({
      missionId: asId("mission-unconfigured"),
      expectedVersion: 1,
      runId: asId("run-unconfigured"),
      conversationId: asId("conversation-unconfigured"),
      auditId: asId("audit-unconfigured"),
      outboxId: asId("outbox-unconfigured"),
      context: { commandId: asId("command-unconfigured"), actor: "user", occurredAt: now }
    })).rejects.toMatchObject({ code: "AGENT_CONFIG_REQUIRED" });
  });

  it("rejects incomplete and unsupported workflow outbox payloads", async () => {
    const store = new SqliteWorkflowOutboxStore(database);
    database.orm.insert(outbox).values({
      id: "outbox-incomplete",
      kind: "workflow.mission.start",
      aggregateId: "mission-incomplete",
      payloadJson: JSON.stringify({ schemaVersion: 1, missionId: "mission-incomplete", commandId: "command" }),
      dedupeKey: "mission/mission-incomplete",
      createdAt: now,
      publishedAt: null
    }).run();
    await expect(store.listPendingStarts(10)).rejects.toMatchObject({ code: "OUTBOX_PAYLOAD_INVALID" });

    database.orm.delete(outbox).run();
    database.orm.insert(outbox).values({
      id: "outbox-unsupported",
      kind: "workflow.mission.start",
      aggregateId: "mission-unsupported",
      payloadJson: JSON.stringify({
        schemaVersion: 2,
        missionId: "mission-unsupported",
        commandId: "command",
        runId: "run"
      }),
      dedupeKey: "mission/mission-unsupported",
      createdAt: now,
      publishedAt: null
    }).run();
    await expect(store.listPendingStarts(10)).rejects.toMatchObject({ code: "OUTBOX_PAYLOAD_INVALID" });

    database.orm.delete(outbox).run();
    database.orm.insert(outbox).values({
      id: "outbox-unknown-run",
      kind: "workflow.mission.start",
      aggregateId: "mission-unknown-run",
      payloadJson: JSON.stringify({
        schemaVersion: 1,
        missionId: "mission-unknown-run",
        commandId: "command",
        runId: "run-unknown"
      }),
      dedupeKey: "mission/mission-unknown-run",
      createdAt: now,
      publishedAt: null
    }).run();
    await expect(store.listPendingStarts(10)).rejects.toMatchObject({ code: "OUTBOX_PAYLOAD_INVALID" });
  });

  it("targets exactly one run among multiple attempts and keeps inbox atomic and idempotent", async () => {
    seedReadyAgent();
    await executeStart();
    database.orm.insert(conversations).values({
      id: "conversation-second-attempt",
      missionId: "mission-agent",
      managerId: null,
      providerId: "provider-configured-not-invoked",
      state: "open",
      createdAt: now
    }).run();
    database.orm.insert(runs).values({
      id: "run-second-attempt",
      missionId: "mission-agent",
      managerId: null,
      conversationId: "conversation-second-attempt",
      userAttempt: 2,
      state: "QUEUED",
      temporalWorkflowId: "run/run-second-attempt",
      providerId: "provider-configured-not-invoked",
      modelId: "model-configured-not-invoked",
      createdAt: now
    }).run();
    const activity = new SqliteRunWorkflowActivity(database);
    const input = {
      missionId: "mission-agent",
      commandId: "command-start",
      runId: "run-second-attempt",
      messageId: "message-stable",
      schemaVersion: 1 as const,
      temporalRunId: "temporal-run-first",
      occurredAt: now
    };
    await expect(activity.recordStarted(input)).resolves.toEqual({ applied: true });
    await expect(activity.recordStarted({ ...input, temporalRunId: "temporal-run-duplicate" }))
      .resolves.toEqual({ applied: false });
    expect(database.orm.select().from(inbox).all()).toHaveLength(1);
    expect(database.orm.select().from(runs).where(eq(runs.id, "run-mission-agent")).get()).toMatchObject({
      state: "QUEUED",
      temporalRunId: null
    });
    expect(database.orm.select().from(runs).where(eq(runs.id, "run-second-attempt")).get()).toMatchObject({
      state: "STARTING",
      temporalRunId: "temporal-run-first"
    });

    await expect(activity.recordStarted({
      ...input,
      runId: "run-missing",
      messageId: "message-missing-run"
    })).rejects.toMatchObject({ code: "PERSISTENCE_FAILURE" });
    expect(database.orm.select().from(inbox).all()).toHaveLength(1);
  });
});
