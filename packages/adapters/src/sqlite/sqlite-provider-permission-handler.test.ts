import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ManageConfirmations } from "@nodra/application";
import { asId } from "@nodra/domain";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { LocalWorkspaceAdapter } from "../git/local-workspace-adapter.js";
import { migrateDatabase } from "./migrate-database.js";
import { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { SqliteConfirmationRepository } from "./sqlite-confirmation-repository.js";
import { SqliteProviderPermissionHandler } from "./sqlite-provider-permission-handler.js";
import { SqliteProviderRunStore } from "./sqlite-provider-run-store.js";
import { confirmations } from "./schema/access-control.js";
import { workspaces } from "./schema/core.js";
import { conversations } from "./schema/conversations.js";
import { missionAgentConfigs, missions } from "./schema/missions.js";
import { runConfigSnapshots, runs } from "./schema/runs.js";

describe("SqliteProviderPermissionHandler", () => {
  const databases: NodraSqliteDatabase[] = [];

  afterEach(() => databases.splice(0).forEach((database) => database.close()));

  it("waits for an exact human confirmation and grants only the requested subset for the turn", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-provider-permission-"));
    const workspacePath = await mkdtemp(join(tmpdir(), "nodra-provider-workspace-"));
    const database = NodraSqliteDatabase.open(join(directory, "nodra.db"));
    databases.push(database);
    await migrateDatabase(database, resolve("packages/adapters/drizzle"));
    const now = "2026-07-26T10:00:00.000Z";
    database.orm.insert(workspaces).values({
      id: "workspace-1",
      projectId: null,
      kind: "scratch",
      path: workspacePath,
      state: "in_use",
      createdAt: now
    }).run();
    database.orm.insert(missions).values({
      id: "mission-1",
      projectId: null,
      title: "permission",
      executionKind: "agent",
      state: "ACTIVE",
      version: 2,
      createdAt: now,
      updatedAt: now
    }).run();
    database.orm.insert(missionAgentConfigs).values({
      missionId: "mission-1",
      providerId: "codex",
      modelId: "model-1",
      reasoningEffort: "medium",
      missionPrompt: "work",
      permissionPreset: "workspace",
      workspaceId: "workspace-1",
      updatedAt: now
    }).run();
    database.orm.insert(conversations).values({
      id: "conversation-1",
      missionId: "mission-1",
      managerId: null,
      providerId: "codex",
      providerSessionRef: "thr_1",
      state: "open",
      createdAt: now
    }).run();
    database.orm.insert(runs).values({
      id: "run-1",
      missionId: "mission-1",
      managerId: null,
      conversationId: "conversation-1",
      userAttempt: 1,
      state: "RUNNING",
      temporalWorkflowId: "run/run-1",
      providerId: "codex",
      modelId: "model-1",
      reasoningEffort: "medium",
      createdAt: now
    }).run();
    database.orm.insert(runConfigSnapshots).values({
      runId: "run-1",
      resolutionSchemaVersion: 1,
      providerIdRequested: "codex",
      providerIdResolved: "codex",
      modelIdRequested: "model-1",
      modelIdResolved: "model-1",
      reasoningEffortRequested: "medium",
      reasoningEffortResolved: "medium",
      providerOptionsSchemaVersion: 1,
      providerOptionsJson: "{}",
      providerCapabilitiesJson: JSON.stringify({
        version: "fixture-v1",
        contract: { status: "certified" }
      }),
      promptKind: "mission",
      promptCompositionSchemaVersion: 1,
      promptEffective: "work",
      promptMission: "work",
      permissionPreset: "workspace",
      budgetSnapshotJson: "{}",
      workspaceId: "workspace-1",
      cwd: workspacePath,
      createdAt: now
    }).run();
    const workspace = new LocalWorkspaceAdapter(join(directory, "managed-workspaces"));
    await workspace.initialize();
    const confirmationsUseCase = new ManageConfirmations(
      new SqliteConfirmationRepository(database),
      workspace
    );
    const handler = new SqliteProviderPermissionHandler(
      confirmationsUseCase,
      new SqliteProviderRunStore(database),
      1
    );
    let settled = false;
    const response = handler.handle("run-1", {
      requestId: 61,
      action: "item/permissions/requestApproval",
      target: {
        method: "item/permissions/requestApproval",
        params: {
          cwd: workspacePath,
          permissions: { fileSystem: { write: [workspacePath] } }
        }
      },
      cwd: workspacePath,
      risk: "provider_permission_expansion",
      providerRequest: {
        id: 61,
        params: {
          cwd: workspacePath,
          permissions: { fileSystem: { write: [workspacePath] } }
        }
      }
    }).finally(() => { settled = true; });
    await expect.poll(() => database.orm.select().from(confirmations).all().length).toBe(1);
    expect(settled).toBe(false);
    const pending = database.orm.select().from(confirmations).get();
    expect(pending).toMatchObject({
      state: "pending",
      action: "item/permissions/requestApproval",
      providerId: "codex",
      permissionPreset: "workspace",
      scope: "run",
      runId: "run-1"
    });
    await confirmationsUseCase.decide({
      id: asId(pending!.id),
      decision: "approved",
      actor: "user",
      comment: "exact request reviewed",
      context: {
        commandId: asId("decision-1"),
        actor: "user",
        occurredAt: "2026-07-26T10:01:00.000Z"
      }
    });

    await expect(response).resolves.toEqual({
      scope: "turn",
      permissions: { fileSystem: { write: [workspacePath] } }
    });
    expect(database.orm.select().from(confirmations)
      .where(eq(confirmations.id, pending!.id)).get()).toMatchObject({ state: "consumed" });
    expect(database.orm.select().from(runs).where(eq(runs.id, "run-1")).get())
      .toMatchObject({ state: "RUNNING" });
  });
});
