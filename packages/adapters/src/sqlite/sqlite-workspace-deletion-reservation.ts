import type { WorkspaceDeletionReservation } from "@nodra/application";
import { DomainError } from "@nodra/application";
import { and, eq, inArray } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { confirmations } from "./schema/access-control.js";
import { workspaces } from "./schema/core.js";
import { businessAuditEvents } from "./schema/operations.js";
import { runConfigSnapshots, runs } from "./schema/runs.js";

export class SqliteWorkspaceDeletionReservation implements WorkspaceDeletionReservation {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async reserve(input: Parameters<WorkspaceDeletionReservation["reserve"]>[0]): Promise<void> {
    const outcome = this.database.orm.transaction((transaction) => {
      const replay = transaction.select({ id: businessAuditEvents.id })
        .from(businessAuditEvents)
        .where(and(
          eq(businessAuditEvents.commandId, input.context.commandId),
          eq(businessAuditEvents.aggregateKind, "workspace"),
          eq(businessAuditEvents.eventType, "WORKSPACE_DELETION_RESERVED")
        )).get();
      if (replay) return "reserved" as const;

      const workspace = transaction.select({
        kind: workspaces.kind,
        path: workspaces.path,
        state: workspaces.state
      }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).get();
      if (!workspace) throw new DomainError("Workspace was not found", "WORKSPACE_NOT_FOUND");
      if (workspace.kind === "repo" || workspace.state !== "ready") {
        throw new DomainError("Workspace is not ready for deletion", "WORKSPACE_STATE_CONFLICT");
      }
      const active = transaction.select({ id: runs.id })
        .from(runConfigSnapshots)
        .innerJoin(runs, eq(runs.id, runConfigSnapshots.runId))
        .where(and(
          eq(runConfigSnapshots.workspaceId, input.workspaceId),
          inArray(runs.state, ["QUEUED", "STARTING", "RUNNING", "WAITING_APPROVAL", "CANCELLING", "UNKNOWN"])
        )).limit(1).get();
      if (active) throw new DomainError("Workspace has an active run", "WORKSPACE_ACTIVE_RUN");

      const confirmation = transaction.select().from(confirmations)
        .where(eq(confirmations.id, input.confirmationId)).get();
      if (!confirmation) return "required" as const;
      if (confirmation.state === "consumed") return "already-consumed" as const;
      if (confirmation.expiresAt <= input.context.occurredAt) {
        if (confirmation.state === "pending" || confirmation.state === "approved") {
          transaction.update(confirmations).set({ state: "expired" })
            .where(eq(confirmations.id, input.confirmationId)).run();
        }
        return "expired" as const;
      }
      if (confirmation.state !== "approved") return "required" as const;
      const exact =
        confirmation.action === input.action &&
        confirmation.targetDigest === input.targetDigest &&
        confirmation.cwd === input.cwd &&
        confirmation.scope === input.scope &&
        confirmation.runId === null &&
        confirmation.missionId === null &&
        confirmation.workspaceId === input.workspaceId;
      if (!exact) return "mismatch" as const;

      const consumed = transaction.update(confirmations).set({
        state: "consumed",
        consumedAt: input.context.occurredAt
      }).where(and(
        eq(confirmations.id, input.confirmationId),
        eq(confirmations.state, "approved")
      )).run();
      if (consumed.changes !== 1) return "already-consumed" as const;
      const reserved = transaction.update(workspaces).set({ state: "pending_delete" })
        .where(and(eq(workspaces.id, input.workspaceId), eq(workspaces.state, "ready"))).run();
      if (reserved.changes !== 1) {
        throw new DomainError("Workspace deletion state conflict", "WORKSPACE_STATE_CONFLICT");
      }
      transaction.insert(businessAuditEvents).values([{
        id: `audit/confirmation/${input.context.commandId}`,
        aggregateKind: "confirmation",
        aggregateId: input.confirmationId,
        commandId: input.context.commandId,
        eventType: "CONFIRMATION_CONSUMED",
        actor: input.context.actor,
        payloadJson: JSON.stringify({
          schemaVersion: 1,
          action: input.action,
          targetDigest: input.targetDigest
        }),
        occurredAt: input.context.occurredAt
      }, {
        id: `audit/workspace/${input.context.commandId}/reserved`,
        aggregateKind: "workspace",
        aggregateId: input.workspaceId,
        commandId: input.context.commandId,
        eventType: "WORKSPACE_DELETION_RESERVED",
        actor: input.context.actor,
        payloadJson: JSON.stringify({
          schemaVersion: 1,
          path: workspace.path,
          kind: workspace.kind,
          confirmationId: input.confirmationId
        }),
        occurredAt: input.context.occurredAt
      }]).run();
      return "reserved" as const;
    });
    if (outcome === "expired") throw new DomainError("Confirmation has expired", "CONFIRMATION_EXPIRED");
    if (outcome === "mismatch") {
      throw new DomainError("Confirmation target or subject does not match", "CONFIRMATION_TARGET_MISMATCH");
    }
    if (outcome === "already-consumed") {
      throw new DomainError("Confirmation was already consumed", "CONFIRMATION_ALREADY_CONSUMED");
    }
    if (outcome === "required") {
      throw new DomainError("An approved exact confirmation is required", "CONFIRMATION_REQUIRED");
    }
  }
}
