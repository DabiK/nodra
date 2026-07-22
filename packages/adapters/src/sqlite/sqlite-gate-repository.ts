import type { CommandContext, GateDefinitionRecord, GateEvaluationRecord, GateRepository } from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { approvals, gateOverrides } from "./schema/approvals.js";
import { evidence, gateBindings, gateDefinitions, gateEvaluationEvidence, gateEvaluations } from "./schema/gates.js";
import { businessAuditEvents } from "./schema/operations.js";
import { runs } from "./schema/runs.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

export class SqliteGateRepository implements GateRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async defineMissionGate(definition: GateDefinitionRecord, binding: Parameters<GateRepository["defineMissionGate"]>[1], context: CommandContext): Promise<void> {
    try {
      this.database.orm.transaction((tx) => {
        this.assertFreshCommand(tx, context.commandId);
        tx.insert(gateDefinitions).values({ id: definition.id, name: definition.name, evaluatorId: definition.evaluatorId, evaluatorVersion: definition.evaluatorVersion, criteriaSchemaVersion: definition.criteriaSchemaVersion, criteriaJson: JSON.stringify(definition.criteria), expectedEvidenceJson: JSON.stringify(definition.expectedEvidence), createdAt: definition.createdAt }).run();
        tx.insert(gateBindings).values({ id: binding.id, gateId: binding.gateId, missionId: binding.missionId, pipelineEdgeId: null, pipelineNodeId: null }).run();
        this.audit(tx, context, "gate", definition.id, "GATE_DEFINED", { gateId: definition.id, bindingId: binding.id, missionId: binding.missionId });
      });
    } catch (error) { throw translateSqliteError(error); }
  }

  async getBinding(bindingId: Parameters<GateRepository["getBinding"]>[0]) {
    try {
      const row = this.database.orm.select({ binding: gateBindings, definition: gateDefinitions }).from(gateBindings).innerJoin(gateDefinitions, eq(gateDefinitions.id, gateBindings.gateId)).where(eq(gateBindings.id, bindingId)).get();
      if (!row?.binding.missionId) throw new DomainError("Mission gate binding was not found", "GATE_BINDING_NOT_FOUND");
      return { binding: { id: toId(row.binding.id), gateId: toId(row.binding.gateId), missionId: toId(row.binding.missionId) }, definition: this.definition(row.definition) };
    } catch (error) { throw translateSqliteError(error); }
  }

  async saveEvaluation(evaluation: GateEvaluationRecord, context: CommandContext): Promise<void> {
    try {
      this.database.orm.transaction((tx) => {
        this.assertFreshCommand(tx, context.commandId);
        const binding = tx.select({ missionId: gateBindings.missionId }).from(gateBindings).where(eq(gateBindings.id, evaluation.gateBindingId)).get();
        const run = tx.select({ missionId: runs.missionId }).from(runs).where(eq(runs.id, evaluation.runId)).get();
        if (!binding?.missionId || run?.missionId !== binding.missionId) throw new DomainError("Gate binding and run mission do not match", "EVIDENCE_RUN_MISMATCH");
        tx.insert(gateEvaluations).values({ id: evaluation.id, gateBindingId: evaluation.gateBindingId, runId: evaluation.runId, evaluatorId: evaluation.evaluatorId, evaluatorVersion: evaluation.evaluatorVersion, state: evaluation.state, evaluatedAt: evaluation.evaluatedAt, staleAt: evaluation.staleAt, rationale: evaluation.rationale }).run();
        for (const evidenceId of evaluation.evidenceIds) {
          const item = tx.select({ runId: evidence.runId }).from(evidence).where(eq(evidence.id, evidenceId)).get();
          if (!item || item.runId !== evaluation.runId) throw new DomainError("Evaluation evidence must belong to the exact run", "EVIDENCE_RUN_MISMATCH");
          tx.insert(gateEvaluationEvidence).values({ evaluationId: evaluation.id, evidenceId, role: evaluation.gitEvidenceIds.includes(evidenceId) ? "git-subject" : "supplied" }).run();
        }
        this.audit(tx, context, "gate_evaluation", evaluation.id, "GATE_EVALUATED", { state: evaluation.state, rationale: evaluation.rationale, evidenceIds: evaluation.evidenceIds });
      });
    } catch (error) { throw translateSqliteError(error); }
  }

  async listEvaluations(gateId: Parameters<GateRepository["listEvaluations"]>[0]) {
    try {
      const rows = this.database.orm.select({ evaluation: gateEvaluations }).from(gateEvaluations).innerJoin(gateBindings, eq(gateBindings.id, gateEvaluations.gateBindingId)).where(eq(gateBindings.gateId, gateId)).orderBy(desc(gateEvaluations.evaluatedAt)).all().map((row) => row.evaluation);
      return this.hydrate(rows);
    } catch (error) { throw translateSqliteError(error); }
  }

  async listPassedGitEvaluations(runId: Parameters<GateRepository["listPassedGitEvaluations"]>[0]) {
    try {
      const rows = this.database.orm.select({ evaluation: gateEvaluations, expectedEvidenceJson: gateDefinitions.expectedEvidenceJson }).from(gateEvaluations).innerJoin(gateBindings, eq(gateBindings.id, gateEvaluations.gateBindingId)).innerJoin(gateDefinitions, eq(gateDefinitions.id, gateBindings.gateId)).where(and(eq(gateEvaluations.runId, runId), eq(gateEvaluations.state, "passed"))).all().filter((row) => {
        const expected = JSON.parse(row.expectedEvidenceJson) as { subject?: { type?: unknown } };
        return expected.subject?.type === "git-tree";
      }).map((row) => row.evaluation);
      return this.hydrate(rows);
    } catch (error) { throw translateSqliteError(error); }
  }

  async markStale(evaluationId: Parameters<GateRepository["markStale"]>[0], staleAt: string, context: CommandContext): Promise<void> {
    try {
      this.database.orm.transaction((tx) => {
        this.assertFreshCommand(tx, context.commandId);
        const changed = tx.update(gateEvaluations).set({ state: "stale", staleAt }).where(and(eq(gateEvaluations.id, evaluationId), eq(gateEvaluations.state, "passed"))).run();
        if (changed.changes !== 1) throw new DomainError("Only a passed evaluation can become stale", "EVIDENCE_STALE");
        this.audit(tx, context, "gate_evaluation", evaluationId, "GATE_EVIDENCE_STALE", { staleAt });
      });
    } catch (error) { throw translateSqliteError(error); }
  }

  async override(input: Parameters<GateRepository["override"]>[0]) {
    try {
      return this.database.orm.transaction((tx) => {
        this.assertFreshCommand(tx, input.context.commandId);
        const row = tx.select({ evaluation: gateEvaluations, missionId: gateBindings.missionId }).from(gateEvaluations).innerJoin(gateBindings, eq(gateBindings.id, gateEvaluations.gateBindingId)).where(eq(gateEvaluations.id, input.evaluationId)).get();
        const approval = tx.select().from(approvals).where(eq(approvals.id, input.approvalId)).get();
        if (!row?.evaluation.runId) throw new DomainError("Gate evaluation was not found", "GATE_EVALUATION_NOT_FOUND");
        const expiry = approval?.expiresAt === null || approval?.expiresAt === undefined ? null : Date.parse(approval.expiresAt);
        if (!approval || approval.state !== "approved" || (expiry !== null && (!Number.isFinite(expiry) || expiry <= Date.parse(input.context.occurredAt)))) throw new DomainError("An approved, unexpired approval is required", "APPROVAL_REQUIRED");
        if (approval.kind !== `gate_override:${input.evaluationId}`) throw new DomainError("Approval purpose does not match the gate evaluation", "APPROVAL_KIND_MISMATCH");
        if (approval.runId !== row.evaluation.runId || approval.missionId !== null || approval.managerId !== null) throw new DomainError("Approval target does not match the exact evaluation run", "APPROVAL_TARGET_MISMATCH");
        if (tx.select({ id: gateOverrides.id }).from(gateOverrides).where(eq(gateOverrides.approvalId, input.approvalId)).get()) throw new DomainError("Approval has already been consumed", "APPROVAL_ALREADY_CONSUMED");
        tx.insert(gateOverrides).values({ id: input.overrideId, evaluationId: input.evaluationId, approvalId: input.approvalId, decision: input.decision, comment: input.comment.trim(), createdAt: input.context.occurredAt }).run();
        this.audit(tx, input.context, "gate_evaluation", input.evaluationId, "GATE_OVERRIDE_RECORDED", { overrideId: input.overrideId, approvalId: input.approvalId, decision: input.decision, comment: input.comment.trim() });
        return this.record(row.evaluation, this.linkedEvidence(tx, row.evaluation.id));
      });
    } catch (error) {
      if (this.isApprovalConsumptionConflict(error)) throw new DomainError("Approval has already been consumed", "APPROVAL_ALREADY_CONSUMED");
      throw translateSqliteError(error);
    }
  }

  private hydrate(rows: Array<typeof gateEvaluations.$inferSelect>): GateEvaluationRecord[] {
    if (rows.length === 0) return [];
    const links = this.database.orm.select().from(gateEvaluationEvidence).where(inArray(gateEvaluationEvidence.evaluationId, rows.map((row) => row.id))).all();
    return rows.map((row) => {
      const rowLinks = links.filter((link) => link.evaluationId === row.id);
      return this.record(row, rowLinks.map((link) => link.evidenceId), rowLinks.filter((link) => link.role === "git-subject").map((link) => link.evidenceId));
    });
  }

  private linkedEvidence(tx: NodraSqliteDatabase["orm"], evaluationId: string): string[] { return tx.select({ evidenceId: gateEvaluationEvidence.evidenceId }).from(gateEvaluationEvidence).where(eq(gateEvaluationEvidence.evaluationId, evaluationId)).all().map((row) => row.evidenceId); }
  private record(row: typeof gateEvaluations.$inferSelect, ids: readonly string[], gitIds: readonly string[] = []): GateEvaluationRecord {
    if (!row.runId) throw new DomainError("Gate evaluation is not attached to a run", "GATE_EVALUATION_INVALID");
    return { id: toId(row.id), gateBindingId: toId(row.gateBindingId), runId: toId(row.runId), evaluatorId: row.evaluatorId, evaluatorVersion: row.evaluatorVersion, state: row.state, evaluatedAt: row.evaluatedAt, staleAt: row.staleAt, rationale: row.rationale ?? "", evidenceIds: ids.map(toId), gitEvidenceIds: gitIds.map(toId) };
  }
  private definition(row: typeof gateDefinitions.$inferSelect): GateDefinitionRecord { return { id: toId(row.id), name: row.name, evaluatorId: row.evaluatorId, evaluatorVersion: row.evaluatorVersion, criteriaSchemaVersion: row.criteriaSchemaVersion, criteria: JSON.parse(row.criteriaJson) as Record<string, unknown>, expectedEvidence: JSON.parse(row.expectedEvidenceJson) as Record<string, unknown>, createdAt: row.createdAt }; }
  private assertFreshCommand(tx: NodraSqliteDatabase["orm"], commandId: string) { if (tx.select({ id: businessAuditEvents.id }).from(businessAuditEvents).where(eq(businessAuditEvents.commandId, commandId)).get()) throw new DomainError("Command was already processed", "COMMAND_ID_CONFLICT"); }
  private audit(tx: NodraSqliteDatabase["orm"], context: CommandContext, aggregateKind: string, aggregateId: string, eventType: string, payload: Record<string, unknown>) { tx.insert(businessAuditEvents).values({ id: `audit/${context.commandId}`, aggregateKind, aggregateId, commandId: context.commandId, eventType, actor: context.actor, payloadJson: JSON.stringify({ schemaVersion: 1, ...payload }), occurredAt: context.occurredAt }).run(); }
  private isApprovalConsumptionConflict(error: unknown): boolean { return !!error && typeof error === "object" && "code" in error && error.code === "SQLITE_CONSTRAINT_UNIQUE" && "message" in error && String(error.message).includes("gate_override.approval_id"); }
}
