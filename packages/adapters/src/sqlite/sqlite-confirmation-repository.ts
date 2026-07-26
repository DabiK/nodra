import type {
  CommandContext,
  ConfirmationRecord,
  ConfirmationRepository
} from "@nodra/application";
import { asId, DomainError } from "@nodra/domain";
import { and, eq, isNull } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { confirmations } from "./schema/access-control.js";
import { businessAuditEvents } from "./schema/operations.js";

export class SqliteConfirmationRepository implements ConfirmationRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async request(
    record: ConfirmationRecord,
    context: Parameters<ConfirmationRepository["request"]>[1]
  ): Promise<void> {
    this.database.orm.transaction((tx) => {
      const replay = tx.select({ id: businessAuditEvents.id }).from(businessAuditEvents)
        .where(and(
          eq(businessAuditEvents.commandId, context.commandId),
          eq(businessAuditEvents.aggregateKind, "confirmation")
        )).get();
      if (replay) return;
      tx.insert(confirmations).values(record).run();
      this.audit(tx, context, record.id, "CONFIRMATION_REQUESTED", {
        action: record.action,
        targetDigest: record.targetDigest,
        scope: record.scope
      });
    });
  }

  async decide(input: Parameters<ConfirmationRepository["decide"]>[0]) {
    const outcome = this.database.orm.transaction((tx) => {
      const replay = tx.select({ id: businessAuditEvents.id }).from(businessAuditEvents)
        .where(and(
          eq(businessAuditEvents.commandId, input.context.commandId),
          eq(businessAuditEvents.aggregateKind, "confirmation")
        )).get();
      if (replay) return "replay" as const;
      const record = tx.select().from(confirmations).where(eq(confirmations.id, input.id)).get();
      if (!record) throw new DomainError("Confirmation was not found", "CONFIRMATION_NOT_FOUND");
      if (record.state !== "pending") {
        throw new DomainError("Confirmation is not pending", "CONFIRMATION_INVALID");
      }
      if (record.expiresAt <= input.context.occurredAt) {
        tx.update(confirmations).set({ state: "expired" })
          .where(and(eq(confirmations.id, input.id), eq(confirmations.state, "pending"))).run();
        return "expired" as const;
      }
      tx.update(confirmations).set({
        state: input.decision,
        decidedBy: input.actor,
        comment: input.comment,
        decidedAt: input.context.occurredAt
      }).where(and(eq(confirmations.id, input.id), eq(confirmations.state, "pending"))).run();
      this.audit(tx, input.context, input.id, "CONFIRMATION_DECIDED", {
        decision: input.decision
      });
      return "decided" as const;
    });
    if (outcome === "expired") {
      throw new DomainError("Confirmation has expired", "CONFIRMATION_EXPIRED");
    }
    return this.show(input.id);
  }

  async consume(input: Parameters<ConfirmationRepository["consume"]>[0]) {
    const outcome = this.database.orm.transaction((tx) => {
      const replay = tx.select({ id: businessAuditEvents.id }).from(businessAuditEvents)
        .where(and(
          eq(businessAuditEvents.commandId, input.context.commandId),
          eq(businessAuditEvents.aggregateKind, "confirmation"),
          eq(businessAuditEvents.aggregateId, input.id)
        )).get();
      if (replay) return "consumed" as const;
      const record = tx.select().from(confirmations).where(eq(confirmations.id, input.id)).get();
      if (!record) return "required" as const;
      if (record.state === "consumed") return "already-consumed" as const;
      if (record.expiresAt <= input.context.occurredAt) {
        if (record.state === "pending" || record.state === "approved") {
          tx.update(confirmations).set({ state: "expired" })
            .where(eq(confirmations.id, input.id)).run();
        }
        return "expired" as const;
      }
      if (record.state !== "approved") return "required" as const;
      const exact =
        record.action === input.action &&
        record.targetDigest === input.targetDigest &&
        record.cwd === input.cwd &&
        record.scope === input.scope &&
        record.runId === input.runId &&
        record.missionId === input.missionId &&
        record.workspaceId === input.workspaceId;
      if (!exact) return "mismatch" as const;
      const changed = tx.update(confirmations).set({
        state: "consumed",
        consumedAt: input.context.occurredAt
      }).where(and(
        eq(confirmations.id, input.id),
        eq(confirmations.state, "approved"),
        this.exact(confirmations.cwd, input.cwd),
        this.exact(confirmations.runId, input.runId),
        this.exact(confirmations.missionId, input.missionId),
        this.exact(confirmations.workspaceId, input.workspaceId)
      )).run();
      if (changed.changes !== 1) return "already-consumed" as const;
      this.audit(tx, input.context, input.id, "CONFIRMATION_CONSUMED", {
        action: input.action,
        targetDigest: input.targetDigest
      });
      return "consumed" as const;
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
    return this.show(input.id);
  }

  async show(id: Parameters<ConfirmationRepository["show"]>[0]): Promise<ConfirmationRecord> {
    const record = this.database.orm.select().from(confirmations).where(eq(confirmations.id, id)).get();
    if (!record) throw new DomainError("Confirmation was not found", "CONFIRMATION_NOT_FOUND");
    return {
      ...record,
      id: asId(record.id),
      runId: record.runId ? asId(record.runId) : null,
      missionId: record.missionId ? asId(record.missionId) : null,
      workspaceId: record.workspaceId ? asId(record.workspaceId) : null
    };
  }

  private exact(column: unknown, value: string | null) {
    return value === null ? isNull(column as never) : eq(column as never, value);
  }

  private audit(
    tx: NodraSqliteDatabase["orm"],
    context: CommandContext,
    confirmationId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): void {
    tx.insert(businessAuditEvents).values({
      id: `audit/confirmation/${context.commandId}`,
      aggregateKind: "confirmation",
      aggregateId: confirmationId,
      commandId: context.commandId,
      eventType,
      actor: context.actor,
      payloadJson: JSON.stringify({ schemaVersion: 1, ...payload }),
      occurredAt: context.occurredAt
    }).run();
  }
}
