import type {
  CommandContext,
  WorkspaceGitSnapshot,
  WorkspaceRecord,
  WorkspaceRepository
} from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { and, eq, inArray } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import {
  repositories,
  workspaceGitSnapshots,
  workspaceRepositories,
  workspaces
} from "./schema/core.js";
import { missionAgentConfigs } from "./schema/missions.js";
import { businessAuditEvents, retentionTombstones } from "./schema/operations.js";
import { runConfigSnapshots, runs } from "./schema/runs.js";

export class SqliteWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async findCommand(commandId: Parameters<WorkspaceRepository["findCommand"]>[0]) {
    const event = this.database.orm
      .select({ aggregateId: businessAuditEvents.aggregateId })
      .from(businessAuditEvents)
      .where(and(
        eq(businessAuditEvents.commandId, commandId),
        eq(businessAuditEvents.aggregateKind, "workspace")
      ))
      .get();
    return event ? this.read(toId(event.aggregateId)) : null;
  }

  async create(input: Parameters<WorkspaceRepository["create"]>[0]) {
    return this.database.orm.transaction((tx) => {
      const replay = tx
        .select({ aggregateId: businessAuditEvents.aggregateId })
        .from(businessAuditEvents)
        .where(and(
          eq(businessAuditEvents.commandId, input.context.commandId),
          eq(businessAuditEvents.aggregateKind, "workspace")
        ))
        .get();
      if (replay) return this.readFrom(tx, replay.aggregateId);
      tx.insert(workspaces).values({
        id: input.id,
        projectId: input.projectId,
        kind: input.kind,
        path: input.path,
        state: "ready",
        createdAt: input.context.occurredAt,
        tombstonedAt: null
      }).run();
      if (input.repository) {
        const repositoryId = `repository/${input.repository.stableIdentity}`;
        tx.insert(repositories).values({
          id: repositoryId,
          stableIdentity: input.repository.stableIdentity,
          canonicalRemote: input.repository.canonicalRemote,
          initialPath: input.repository.canonicalPath,
          currentPath: input.repository.canonicalPath,
          discoveredAt: input.context.occurredAt,
          movedAt: null
        }).onConflictDoUpdate({
          target: repositories.stableIdentity,
          set: {
            canonicalRemote: input.repository.canonicalRemote,
            currentPath: input.repository.canonicalPath
          }
        }).run();
        const persistedRepository = tx
          .select({ id: repositories.id })
          .from(repositories)
          .where(eq(repositories.stableIdentity, input.repository.stableIdentity))
          .get();
        if (!persistedRepository) throw new DomainError("Repository identity was not persisted", "PERSISTENCE_FAILURE");
        tx.insert(workspaceRepositories).values({
          workspaceId: input.id,
          repositoryId: persistedRepository.id,
          baseRef: input.baseRef,
          headRef: input.repository.head,
          branchName: input.branchName,
          integrationTargetRef: input.integrationTargetRef,
          tombstonedAt: null
        }).run();
      }
      if (input.snapshot) {
        this.insertSnapshot(tx, `${input.context.commandId}/initial`, input.id, "workspace.created", input.snapshot);
      }
      this.audit(tx, input.context, input.id, "WORKSPACE_CREATED", {
        kind: input.kind,
        path: input.path
      });
      return this.readFrom(tx, input.id);
    });
  }

  async read(id: Parameters<WorkspaceRepository["read"]>[0]) {
    return this.readFrom(this.database.orm, id);
  }

  async saveSnapshot(input: Parameters<WorkspaceRepository["saveSnapshot"]>[0]) {
    return this.database.orm.transaction((tx) => {
      const replay = tx
        .select({ id: businessAuditEvents.id })
        .from(businessAuditEvents)
        .where(and(
          eq(businessAuditEvents.commandId, input.context.commandId),
          eq(businessAuditEvents.aggregateKind, "workspace")
        ))
        .get();
      if (replay) {
        const row = tx.select().from(workspaceGitSnapshots).where(eq(workspaceGitSnapshots.id, input.id)).get();
        if (row) return this.snapshotRecord(row);
        throw new DomainError("Command id was already used for another mutation", "COMMAND_ID_CONFLICT");
      }
      const workspace = this.readFrom(tx, input.workspaceId);
      if (!workspace.repository || workspace.state === "deleted") {
        throw new DomainError("Workspace has no observable Git repository", "WORKSPACE_STATE_CONFLICT");
      }
      this.insertSnapshot(tx, input.id, input.workspaceId, input.reason, input.snapshot);
      this.audit(tx, input.context, input.workspaceId, "WORKSPACE_SNAPSHOT_CAPTURED", {
        reason: input.reason,
        head: input.snapshot.head,
        treeDigest: input.snapshot.treeDigest
      });
      return input.snapshot;
    });
  }

  async missionAllowsAutoCommit(
    missionId: Parameters<WorkspaceRepository["missionAllowsAutoCommit"]>[0],
    workspaceId: Parameters<WorkspaceRepository["missionAllowsAutoCommit"]>[1]
  ) {
    const config = this.database.orm
      .select({
        workspaceId: missionAgentConfigs.workspaceId,
        autoCommitAuthorized: missionAgentConfigs.autoCommitAuthorized
      })
      .from(missionAgentConfigs)
      .where(eq(missionAgentConfigs.missionId, missionId))
      .get();
    if (!config || config.workspaceId !== workspaceId) {
      throw new DomainError("Mission is not configured for this workspace", "WORKSPACE_STATE_CONFLICT");
    }
    return config.autoCommitAuthorized === 1;
  }

  async assertDeletable(workspaceId: Parameters<WorkspaceRepository["assertDeletable"]>[0]) {
    const workspace = await this.read(workspaceId);
    if (workspace.state === "deleted") return workspace;
    if (workspace.state !== "ready") {
      throw new DomainError("Workspace is not ready for deletion", "WORKSPACE_STATE_CONFLICT");
    }
    const active = this.database.orm
      .select({ id: runs.id })
      .from(runConfigSnapshots)
      .innerJoin(runs, eq(runs.id, runConfigSnapshots.runId))
      .where(and(
        eq(runConfigSnapshots.workspaceId, workspaceId),
        inArray(runs.state, ["QUEUED", "STARTING", "RUNNING", "WAITING_APPROVAL", "CANCELLING", "UNKNOWN"])
      ))
      .limit(1)
      .get();
    if (active) throw new DomainError("Workspace has an active run", "WORKSPACE_ACTIVE_RUN");
    return workspace;
  }

  async recordGitMutation(input: Parameters<WorkspaceRepository["recordGitMutation"]>[0]) {
    return this.database.orm.transaction((tx) => {
      const replay = tx
        .select({ id: businessAuditEvents.id })
        .from(businessAuditEvents)
        .where(and(
          eq(businessAuditEvents.commandId, input.context.commandId),
          eq(businessAuditEvents.aggregateKind, "workspace")
        ))
        .get();
      if (replay) {
        const workspace = this.readFrom(tx, input.workspaceId);
        return { workspace, before: input.before, after: input.after };
      }
      this.insertSnapshot(tx, input.beforeId, input.workspaceId, `${input.reason}.before`, input.before);
      this.insertSnapshot(tx, input.afterId, input.workspaceId, `${input.reason}.after`, input.after);
      tx.update(workspaceRepositories).set({
        headRef: input.after.head,
        branchName: input.after.branchName
      }).where(eq(workspaceRepositories.workspaceId, input.workspaceId)).run();
      this.audit(tx, input.context, input.workspaceId, "WORKSPACE_GIT_MUTATED", {
        reason: input.reason,
        beforeHead: input.before.head,
        afterHead: input.after.head
      });
      return {
        workspace: this.readFrom(tx, input.workspaceId),
        before: input.before,
        after: input.after
      };
    });
  }

  async tombstone(input: Parameters<WorkspaceRepository["tombstone"]>[0]) {
    return this.database.orm.transaction((tx) => {
      const replay = tx
        .select({ aggregateId: businessAuditEvents.aggregateId })
        .from(businessAuditEvents)
        .where(and(
          eq(businessAuditEvents.commandId, input.context.commandId),
          eq(businessAuditEvents.aggregateKind, "workspace")
        ))
        .get();
      if (replay) return this.readFrom(tx, replay.aggregateId);
      const current = this.readFrom(tx, input.workspaceId);
      if (current.state === "deleted") return current;
      const pending = tx.update(workspaces)
        .set({ state: "pending_delete" })
        .where(and(eq(workspaces.id, input.workspaceId), eq(workspaces.state, "ready")))
        .run();
      if (pending.changes !== 1) {
        throw new DomainError("Workspace deletion state conflict", "WORKSPACE_STATE_CONFLICT");
      }
      tx.update(workspaces).set({
        state: "deleted",
        tombstonedAt: input.context.occurredAt
      }).where(and(
        eq(workspaces.id, input.workspaceId),
        eq(workspaces.state, "pending_delete")
      )).run();
      tx.update(workspaceRepositories).set({
        tombstonedAt: input.context.occurredAt
      }).where(eq(workspaceRepositories.workspaceId, input.workspaceId)).run();
      tx.insert(retentionTombstones).values({
        id: `tombstone/workspace/${input.workspaceId}`,
        entityKind: "workspace",
        entityId: input.workspaceId,
        deletedAt: input.context.occurredAt,
        restoredAt: null,
        purgeRequestedAt: null,
        purgedAt: null,
        purgeState: "soft_deleted"
      }).onConflictDoUpdate({
        target: retentionTombstones.id,
        set: {
          deletedAt: input.context.occurredAt,
          restoredAt: null,
          purgeState: "soft_deleted"
        }
      }).run();
      this.audit(tx, input.context, input.workspaceId, "WORKSPACE_TOMBSTONED", {
        path: current.path,
        kind: current.kind
      });
      return this.readFrom(tx, input.workspaceId);
    });
  }

  async restore(input: Parameters<WorkspaceRepository["restore"]>[0]) {
    return this.database.orm.transaction((tx) => {
      const replay = tx
        .select({ aggregateId: businessAuditEvents.aggregateId })
        .from(businessAuditEvents)
        .where(and(
          eq(businessAuditEvents.commandId, input.context.commandId),
          eq(businessAuditEvents.aggregateKind, "workspace")
        ))
        .get();
      if (replay) return this.readFrom(tx, replay.aggregateId);
      const changed = tx.update(workspaces).set({
        state: "ready",
        tombstonedAt: null
      }).where(and(eq(workspaces.id, input.workspaceId), eq(workspaces.state, "deleted"))).run();
      if (changed.changes !== 1) {
        throw new DomainError("Only a tombstoned workspace can be restored", "WORKSPACE_STATE_CONFLICT");
      }
      tx.update(workspaceRepositories).set({ tombstonedAt: null })
        .where(eq(workspaceRepositories.workspaceId, input.workspaceId)).run();
      tx.update(retentionTombstones).set({
        restoredAt: input.context.occurredAt,
        purgeState: "restored"
      }).where(and(
        eq(retentionTombstones.entityKind, "workspace"),
        eq(retentionTombstones.entityId, input.workspaceId),
        eq(retentionTombstones.purgeState, "soft_deleted")
      )).run();
      this.audit(tx, input.context, input.workspaceId, "WORKSPACE_RESTORED", {});
      return this.readFrom(tx, input.workspaceId);
    });
  }

  private readFrom(tx: NodraSqliteDatabase["orm"], id: string): WorkspaceRecord {
    const row = tx.select().from(workspaces).where(eq(workspaces.id, id)).get();
    if (!row) throw new DomainError("Workspace was not found", "WORKSPACE_NOT_FOUND");
    const linked = tx
      .select({
        id: repositories.id,
        stableIdentity: repositories.stableIdentity,
        canonicalRemote: repositories.canonicalRemote,
        baseRef: workspaceRepositories.baseRef,
        headRef: workspaceRepositories.headRef,
        branchName: workspaceRepositories.branchName,
        integrationTargetRef: workspaceRepositories.integrationTargetRef
      })
      .from(workspaceRepositories)
      .innerJoin(repositories, eq(repositories.id, workspaceRepositories.repositoryId))
      .where(eq(workspaceRepositories.workspaceId, id))
      .get();
    return {
      ...row,
      id: toId(row.id),
      projectId: row.projectId ? toId(row.projectId) : null,
      repository: linked
        ? {
            ...linked,
            id: toId(linked.id)
          }
        : null
    };
  }

  private insertSnapshot(
    tx: NodraSqliteDatabase["orm"],
    id: string,
    workspaceId: string,
    reason: string,
    snapshot: WorkspaceGitSnapshot
  ): void {
    tx.insert(workspaceGitSnapshots).values({
      id,
      workspaceId,
      reason,
      head: snapshot.head,
      treeDigest: snapshot.treeDigest,
      branchName: snapshot.branchName,
      capturedAt: snapshot.capturedAt
    }).run();
  }

  private snapshotRecord(row: typeof workspaceGitSnapshots.$inferSelect): WorkspaceGitSnapshot {
    return {
      head: row.head,
      treeDigest: row.treeDigest,
      diffDigest: null,
      branchName: row.branchName,
      capturedAt: row.capturedAt
    };
  }

  private audit(
    tx: NodraSqliteDatabase["orm"],
    context: CommandContext,
    workspaceId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): void {
    tx.insert(businessAuditEvents).values({
      id: `audit/${context.commandId}`,
      aggregateKind: "workspace",
      aggregateId: workspaceId,
      commandId: context.commandId,
      eventType,
      actor: context.actor,
      payloadJson: JSON.stringify({ schemaVersion: 1, ...payload }),
      occurredAt: context.occurredAt
    }).run();
  }
}
