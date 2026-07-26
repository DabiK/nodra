import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CreateWorkspace,
  DeleteWorkspace,
  ManageConfirmations,
  StartMission,
  toId,
  type WorkspacePort
} from "@nodra/application";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalWorkspaceAdapter } from "../git/local-workspace-adapter.js";
import { migrateDatabase } from "./migrate-database.js";
import { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { SqliteConfirmationRepository } from "./sqlite-confirmation-repository.js";
import { SqliteMissionExecutionRepository } from "./sqlite-mission-execution-repository.js";
import { SqliteMissionRepository } from "./sqlite-mission-repository.js";
import { SqliteRunWorkflowActivity } from "./sqlite-run-workflow-activity.js";
import { workspaces } from "./schema/core.js";
import { missionAgentConfigs, missions } from "./schema/missions.js";
import { businessAuditEvents } from "./schema/operations.js";
import { runs } from "./schema/runs.js";
import { SqliteWorkspaceRepository } from "./sqlite-workspace-repository.js";
import { SqliteWorkspaceDeletionReservation } from "./sqlite-workspace-deletion-reservation.js";
import { eq } from "drizzle-orm";

const now = "2026-07-26T12:00:00.000Z";

describe("I5.1 workspace lifecycle concurrency", () => {
  let database: NodraSqliteDatabase;
  let root: string;
  let path: string;
  let local: LocalWorkspaceAdapter;
  let workspaceRepository: SqliteWorkspaceRepository;
  let confirmations: ManageConfirmations;

  const context = (commandId: string) => ({
    commandId: toId(commandId),
    actor: "user" as const,
    occurredAt: now
  });

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "nodra-i51-")));
    database = NodraSqliteDatabase.open(join(root, "nodra.db"));
    await migrateDatabase(database, resolve("packages/adapters/drizzle"));
    local = new LocalWorkspaceAdapter(join(root, "managed"));
    await local.initialize();
    workspaceRepository = new SqliteWorkspaceRepository(database);
    confirmations = new ManageConfirmations(
      new SqliteConfirmationRepository(database),
      local
    );
    path = join(root, "managed", "workspace");
    await new CreateWorkspace(workspaceRepository, local).execute({
      id: toId("workspace"),
      kind: "scratch",
      path,
      context: context("create-workspace")
    });
    database.orm.insert(missions).values({
      id: "mission",
      projectId: null,
      title: "Lifecycle",
      executionKind: "agent",
      state: "READY",
      version: 1,
      createdAt: now,
      updatedAt: now
    }).run();
    database.orm.insert(missionAgentConfigs).values({
      missionId: "mission",
      providerId: "provider-not-called",
      modelId: "model-not-called",
      providerOptionsJson: "{}",
      missionPrompt: "",
      permissionPreset: "read_only",
      workspaceId: "workspace",
      updatedAt: now
    }).run();
  });

  afterEach(() => database.close());

  it("reserves pending_delete with confirmation before Activity and blocks concurrent start", async () => {
    const confirmationId = await approveDeletion("delete-confirmation");
    let enterActivity!: () => void;
    let releaseActivity!: () => void;
    const activityEntered = new Promise<void>((resolvePromise) => {
      enterActivity = resolvePromise;
    });
    const activityReleased = new Promise<void>((resolvePromise) => {
      releaseActivity = resolvePromise;
    });
    const controlledPort: WorkspacePort = {
      canonicalizeExisting: (value) => local.canonicalizeExisting(value),
      createScratch: (value) => local.createScratch(value),
      inspectRepository: (value) => local.inspectRepository(value),
      createWorktree: (value) => local.createWorktree(value),
      snapshot: (value) => local.snapshot(value),
      commit: (value) => local.commit(value),
      integrate: (value) => local.integrate(value),
      deleteActivity: async () => {
        enterActivity();
        await activityReleased;
      }
    };
    const deletion = new DeleteWorkspace(
      workspaceRepository,
      controlledPort,
      new SqliteWorkspaceDeletionReservation(database)
    ).execute({
      workspaceId: toId("workspace"),
      confirmationId,
      context: context("delete-workspace")
    });
    await activityEntered;

    expect(workspaceState()).toBe("pending_delete");
    expect((await confirmations.show(confirmationId)).state).toBe("consumed");
    await expect(startMission("start-during-delete")).rejects.toMatchObject({
      code: "WORKSPACE_STATE_CONFLICT",
      message: expect.stringContaining("pending_delete")
    });
    expect(database.orm.select().from(runs).all()).toHaveLength(0);
    expect(database.orm.select().from(missions).where(eq(missions.id, "mission")).get())
      .toMatchObject({ state: "READY", version: 1 });

    releaseActivity();
    await expect(deletion).resolves.toMatchObject({ state: "deleted" });
    await expect(startMission("start-after-delete")).rejects.toMatchObject({
      code: "WORKSPACE_STATE_CONFLICT",
      message: expect.stringContaining("deleted")
    });
  });

  it("keeps an approved confirmation unconsumed when start owns the workspace first", async () => {
    await startMission("start-wins");
    expect(workspaceState()).toBe("in_use");
    const confirmationId = await approveDeletion("delete-after-start-confirmation");
    await expect(new DeleteWorkspace(
      workspaceRepository,
      local,
      new SqliteWorkspaceDeletionReservation(database)
    ).execute({
      workspaceId: toId("workspace"),
      confirmationId,
      context: context("delete-after-start")
    })).rejects.toMatchObject({ code: "WORKSPACE_STATE_CONFLICT" });
    expect((await confirmations.show(confirmationId)).state).toBe("approved");
    expect(workspaceState()).toBe("in_use");
  });

  it.each(["SUCCEEDED", "FAILED", "CANCELLED"] as const)(
    "returns in_use to ready when a run becomes %s",
    async (state) => {
      await startMission(`start-${state}`);
      const activity = new SqliteRunWorkflowActivity(database);
      await activity.recordStarted({
        missionId: "mission",
        commandId: `start-${state}`,
        runId: "run-mission",
        messageId: `started-${state}`,
        schemaVersion: 1,
        temporalRunId: `temporal-${state}`,
        occurredAt: now
      });
      await expect(activity.recordTerminal({
        missionId: "mission",
        commandId: `start-${state}`,
        runId: "run-mission",
        messageId: `terminal-${state}`,
        state,
        schemaVersion: 1,
        temporalRunId: `temporal-${state}`,
        occurredAt: "2026-07-26T12:01:00.000Z"
      })).resolves.toEqual({ applied: true });
      expect(workspaceState()).toBe("ready");
      expect(database.orm.select().from(runs).where(eq(runs.id, "run-mission")).get())
        .toMatchObject({ state, endedAt: "2026-07-26T12:01:00.000Z" });
      expect(database.orm.select().from(businessAuditEvents)
        .where(eq(businessAuditEvents.eventType, "WORKSPACE_RELEASED_FROM_RUN")).all())
        .toHaveLength(1);
      await expect(activity.recordTerminal({
        missionId: "mission",
        commandId: `start-${state}`,
        runId: "run-mission",
        messageId: `terminal-${state}`,
        state,
        schemaVersion: 1,
        temporalRunId: `temporal-${state}`,
        occurredAt: "2026-07-26T12:01:00.000Z"
      })).resolves.toEqual({ applied: false });
    }
  );

  const startMission = (commandId: string) =>
    new StartMission(
      new SqliteMissionRepository(database),
      new SqliteMissionExecutionRepository(database),
      { check: async () => ({ status: "ok" }) }
    ).execute({
      missionId: toId("mission"),
      expectedVersion: 1,
      runId: toId("run-mission"),
      conversationId: toId("conversation-mission"),
      auditId: toId(`audit/${commandId}`),
      outboxId: toId(`outbox/${commandId}`),
      context: context(commandId)
    });

  const approveDeletion = async (id: string) => {
    const confirmationId = toId(id);
    await confirmations.request({
      id: confirmationId,
      action: "workspace.delete",
      target: { path, workspaceId: "workspace" },
      cwd: path,
      risk: "destructive",
      scope: "once",
      workspaceId: toId("workspace"),
      expiresAt: "2026-07-26T12:10:00.000Z",
      context: context(`${id}-request`)
    });
    await confirmations.decide({
      id: confirmationId,
      decision: "approved",
      actor: "human",
      comment: "reviewed",
      context: context(`${id}-decision`)
    });
    return confirmationId;
  };

  const workspaceState = () =>
    database.orm.select({ state: workspaces.state }).from(workspaces)
      .where(eq(workspaces.id, "workspace")).get()?.state;
});
