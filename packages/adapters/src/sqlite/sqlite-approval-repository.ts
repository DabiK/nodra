import type { ApprovalRecord, ApprovalRepository, CommandContext } from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { and, eq } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { approvals } from "./schema/approvals.js";
import { businessAuditEvents, relayItems } from "./schema/operations.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

export class SqliteApprovalRepository implements ApprovalRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}
  async request(record: ApprovalRecord, context: CommandContext): Promise<void> {
    try {
      this.database.orm.transaction((tx) => {
        this.fresh(tx, context.commandId);
        tx.insert(approvals).values({ id: record.id, runId: "runId" in record.subject ? record.subject.runId : null, missionId: "missionId" in record.subject ? record.subject.missionId : null, managerId: "managerId" in record.subject ? record.subject.managerId : null, kind: record.kind, state: record.state, expiresAt: record.expiresAt, decidedAt: null, decidedBy: null, decisionComment: null, createdAt: record.createdAt }).run();
        const missionId = "missionId" in record.subject ? record.subject.missionId : null;
        if (missionId) tx.insert(relayItems).values({ id: `relay/mission/${missionId}`, missionId, pipelineRunId: null, queue: "decision_required", state: "unread", reasonCode: "approval_pending", createdAt: context.occurredAt }).onConflictDoUpdate({ target: relayItems.id, set: { queue: "decision_required", state: "unread", reasonCode: "approval_pending", createdAt: context.occurredAt, readAt: null, snoozedUntil: null, resolvedAt: null } }).run();
        this.audit(tx, context, record.id, "APPROVAL_REQUESTED", { kind: record.kind, subject: record.subject });
      });
    } catch (error) { throw translateSqliteError(error); }
  }
  async show(id: Parameters<ApprovalRepository["show"]>[0]) {
    try { const row = this.database.orm.select().from(approvals).where(eq(approvals.id, id)).get(); if (!row) throw new DomainError("Approval was not found", "APPROVAL_NOT_FOUND"); return this.record(row); }
    catch (error) { throw translateSqliteError(error); }
  }
  async decide(input: Parameters<ApprovalRepository["decide"]>[0]) {
    try {
      const result = this.database.orm.transaction((tx) => {
        this.fresh(tx, input.context.commandId);
        const current = tx.select().from(approvals).where(eq(approvals.id, input.id)).get();
        if (!current) throw new DomainError("Approval was not found", "APPROVAL_NOT_FOUND");
        if (current.state !== "pending") throw new DomainError("Approval has already been decided", "APPROVAL_ALREADY_DECIDED");
        const expiry = current.expiresAt === null ? null : Date.parse(current.expiresAt);
        if (expiry !== null && (!Number.isFinite(expiry) || expiry <= Date.parse(input.context.occurredAt))) {
          tx.update(approvals).set({ state: "expired", decidedAt: input.context.occurredAt, decidedBy: input.actor, decisionComment: input.comment }).where(and(eq(approvals.id, input.id), eq(approvals.state, "pending"))).run();
          this.audit(tx, input.context, input.id, "APPROVAL_EXPIRED", { actor: input.actor, comment: input.comment });
          return { expired: true as const, record: this.record({ ...current, state: "expired" as const, decidedAt: input.context.occurredAt, decidedBy: input.actor, decisionComment: input.comment }) };
        }
        const changed = tx.update(approvals).set({ state: input.decision, decidedAt: input.context.occurredAt, decidedBy: input.actor, decisionComment: input.comment }).where(and(eq(approvals.id, input.id), eq(approvals.state, "pending"))).run();
        if (changed.changes !== 1) throw new DomainError("Approval has already been decided", "APPROVAL_ALREADY_DECIDED");
        this.audit(tx, input.context, input.id, "APPROVAL_DECIDED", { decision: input.decision, actor: input.actor, comment: input.comment });
        return { expired: false as const, record: this.record({ ...current, state: input.decision, decidedAt: input.context.occurredAt, decidedBy: input.actor, decisionComment: input.comment }) };
      });
      if (result.expired) throw new DomainError("Approval has expired", "APPROVAL_EXPIRED");
      return result.record;
    } catch (error) { throw translateSqliteError(error); }
  }
  private record(row: typeof approvals.$inferSelect): ApprovalRecord {
    const subject = row.runId ? { runId: toId(row.runId) } : row.missionId ? { missionId: toId(row.missionId) } : row.managerId ? { managerId: toId(row.managerId) } : null;
    if (!subject) throw new DomainError("Approval subject is invalid", "APPROVAL_INVALID");
    return { id: toId(row.id), subject, kind: row.kind, state: row.state, expiresAt: row.expiresAt, decidedAt: row.decidedAt, decidedBy: row.decidedBy, decisionComment: row.decisionComment, createdAt: row.createdAt };
  }
  private fresh(tx: NodraSqliteDatabase["orm"], commandId: string) { if (tx.select({ id: businessAuditEvents.id }).from(businessAuditEvents).where(eq(businessAuditEvents.commandId, commandId)).get()) throw new DomainError("Command was already processed", "COMMAND_ID_CONFLICT"); }
  private audit(tx: NodraSqliteDatabase["orm"], context: CommandContext, id: string, eventType: string, payload: Record<string, unknown>) { tx.insert(businessAuditEvents).values({ id: `audit/${context.commandId}`, aggregateKind: "approval", aggregateId: id, commandId: context.commandId, eventType, actor: context.actor, payloadJson: JSON.stringify({ schemaVersion: 1, ...payload }), occurredAt: context.occurredAt }).run(); }
}
