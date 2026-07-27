import type { CommandContext, DeliveryRecord, DeliveryRepository } from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { and, desc, eq } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { gateOverrides, runDeliveries } from "./schema/approvals.js";
import { gateBindings, gateEvaluations } from "./schema/gates.js";
import { missions } from "./schema/missions.js";
import { businessAuditEvents, relayItems } from "./schema/operations.js";
import { runs } from "./schema/runs.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

export class SqliteDeliveryRepository implements DeliveryRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}
  async show(runId: Parameters<DeliveryRepository["show"]>[0]) {
    try { const row = this.database.orm.select().from(runDeliveries).where(eq(runDeliveries.runId, runId)).get(); if (!row) throw new DomainError("Delivery was not found", "DELIVERY_NOT_FOUND"); return this.record(row); }
    catch (error) { throw translateSqliteError(error); }
  }
  async declare(input: Parameters<DeliveryRepository["declare"]>[0]) {
    try {
      return this.database.orm.transaction((tx) => {
        this.fresh(tx, input.context.commandId);
        const run = tx.select({ missionId: runs.missionId }).from(runs).where(eq(runs.id, input.runId)).get();
        if (!run?.missionId) throw new DomainError("Mission run was not found", "RUN_NOT_FOUND");
        const mission = tx.select({ state: missions.state }).from(missions).where(and(eq(missions.id, run.missionId), eq(missions.version, input.expectedMissionVersion))).get();
        if (!mission) throw new DomainError("Mission version conflict or delivery transition forbidden", "MISSION_VERSION_CONFLICT");
        if (mission.state === "ACTIVE") {
          const changed = tx.update(missions).set({ state: "VALIDATION", version: input.expectedMissionVersion + 1, updatedAt: input.context.occurredAt }).where(and(eq(missions.id, run.missionId), eq(missions.version, input.expectedMissionVersion), eq(missions.state, "ACTIVE"))).run();
          if (changed.changes !== 1) throw new DomainError("Mission version conflict or delivery transition forbidden", "MISSION_VERSION_CONFLICT");
        } else if (mission.state !== "VALIDATION") {
          throw new DomainError("Mission delivery transition forbidden", "TRANSITION_FORBIDDEN");
        }
        const value = { id: input.id, runId: input.runId, agentDeclaration: input.agentDeclaration.trim(), observationSummary: input.observationSummary.trim() || null, resultState: "delivered" as const, acceptedAt: null, decisionComment: null, createdAt: input.context.occurredAt, updatedAt: input.context.occurredAt };
        tx.insert(runDeliveries).values(value).run();
        tx.insert(relayItems).values({ id: `relay/mission/${run.missionId}`, missionId: run.missionId, pipelineRunId: null, queue: "decision_required", state: "unread", reasonCode: "delivery_pending", createdAt: input.context.occurredAt }).onConflictDoUpdate({ target: relayItems.id, set: { queue: "decision_required", state: "unread", reasonCode: "delivery_pending", createdAt: input.context.occurredAt, readAt: null, snoozedUntil: null, resolvedAt: null } }).run();
        this.audit(tx, input.context, input.runId, "DELIVERY_DECLARED", { deliveryId: input.id, missionId: run.missionId, agentDeclaration: input.agentDeclaration.trim(), observationSummary: input.observationSummary.trim() || null });
        return this.record(value);
      });
    } catch (error) { throw translateSqliteError(error); }
  }
  async decide(input: Parameters<DeliveryRepository["decide"]>[0]) {
    try {
      return this.database.orm.transaction((tx) => {
        this.fresh(tx, input.context.commandId);
        const delivery = tx.select().from(runDeliveries).where(eq(runDeliveries.runId, input.runId)).get();
        const run = tx.select({ missionId: runs.missionId }).from(runs).where(eq(runs.id, input.runId)).get();
        if (!delivery || !run?.missionId) throw new DomainError("Delivery was not found", "DELIVERY_NOT_FOUND");
        if (delivery.resultState !== "delivered") throw new DomainError("Delivery has already been decided", "DELIVERY_ALREADY_DECIDED");
        if (input.decision === "accept") this.assertRequiredGatesSatisfied(tx, run.missionId, input.runId);
        const resultState = input.decision === "accept" ? "accepted" : input.decision === "request-changes" ? "changes_requested" : "rejected";
        const missionState = input.decision === "accept" ? "DONE" : "READY";
        const changed = tx.update(missions).set({ state: missionState, version: input.expectedMissionVersion + 1, updatedAt: input.context.occurredAt }).where(and(eq(missions.id, run.missionId), eq(missions.version, input.expectedMissionVersion), eq(missions.state, "VALIDATION"))).run();
        if (changed.changes !== 1) throw new DomainError("Mission version conflict or acceptance transition forbidden", "MISSION_VERSION_CONFLICT");
        tx.update(runDeliveries).set({ resultState, acceptedAt: input.decision === "accept" ? input.context.occurredAt : null, decisionComment: input.comment.trim(), updatedAt: input.context.occurredAt }).where(and(eq(runDeliveries.runId, input.runId), eq(runDeliveries.resultState, "delivered"))).run();
        tx.insert(relayItems).values({ id: `relay/mission/${run.missionId}`, missionId: run.missionId, pipelineRunId: null, queue: input.decision === "accept" ? "decision_required" : "ready", state: input.decision === "accept" ? "resolved" : "unread", reasonCode: input.decision === "accept" ? "delivery_accepted" : resultState, createdAt: input.context.occurredAt, resolvedAt: input.decision === "accept" ? input.context.occurredAt : null }).onConflictDoUpdate({ target: relayItems.id, set: { queue: input.decision === "accept" ? "decision_required" : "ready", state: input.decision === "accept" ? "resolved" : "unread", reasonCode: input.decision === "accept" ? "delivery_accepted" : resultState, createdAt: input.context.occurredAt, resolvedAt: input.decision === "accept" ? input.context.occurredAt : null } }).run();
        this.audit(tx, input.context, input.runId, "DELIVERY_DECIDED", { decision: input.decision, comment: input.comment.trim(), missionId: run.missionId });
        return this.record({ ...delivery, resultState, acceptedAt: input.decision === "accept" ? input.context.occurredAt : null, decisionComment: input.comment.trim(), updatedAt: input.context.occurredAt });
      });
    } catch (error) { throw translateSqliteError(error); }
  }
  private assertRequiredGatesSatisfied(tx: NodraSqliteDatabase["orm"], missionId: string, runId: string) {
    const bindings = tx.select({ id: gateBindings.id }).from(gateBindings).where(eq(gateBindings.missionId, missionId)).all();
    for (const binding of bindings) {
      const latest = tx.select().from(gateEvaluations).where(and(eq(gateEvaluations.gateBindingId, binding.id), eq(gateEvaluations.runId, runId))).orderBy(desc(gateEvaluations.evaluatedAt), desc(gateEvaluations.id)).limit(1).get();
      if (!latest) throw new DomainError("Required gate has no evaluation", "GATES_NOT_SATISFIED");
      if (latest.state === "passed") continue;
      const override = tx.select().from(gateOverrides).where(eq(gateOverrides.evaluationId, latest.id)).orderBy(desc(gateOverrides.createdAt)).limit(1).get();
      if (!override || !["accept", "waive"].includes(override.decision)) throw new DomainError("Required gates are not passed or explicitly overridden", latest.state === "stale" ? "EVIDENCE_STALE" : "GATES_NOT_SATISFIED");
    }
  }
  private record(row: typeof runDeliveries.$inferSelect): DeliveryRecord { return { ...row, id: toId(row.id), runId: toId(row.runId) }; }
  private fresh(tx: NodraSqliteDatabase["orm"], commandId: string) { if (tx.select({ id: businessAuditEvents.id }).from(businessAuditEvents).where(eq(businessAuditEvents.commandId, commandId)).get()) throw new DomainError("Command was already processed", "COMMAND_ID_CONFLICT"); }
  private audit(tx: NodraSqliteDatabase["orm"], context: CommandContext, runId: string, eventType: string, payload: Record<string, unknown>) { tx.insert(businessAuditEvents).values({ id: `audit/${context.commandId}`, aggregateKind: "run", aggregateId: runId, commandId: context.commandId, eventType, actor: context.actor, payloadJson: JSON.stringify({ schemaVersion: 1, ...payload }), occurredAt: context.occurredAt }).run(); }
}
