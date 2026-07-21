import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { blobs } from "./core.js";
import { missions } from "./missions.js";
import { pipelineEdges, pipelineNodes } from "./pipelines.js";
import { runs } from "./runs.js";

export const gateDefinitions = sqliteTable("gate_definition", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  evaluatorId: text("evaluator_id").notNull(),
  evaluatorVersion: text("evaluator_version").notNull(),
  criteriaSchemaVersion: integer("criteria_schema_version").notNull(),
  criteriaJson: text("criteria_json").notNull(),
  expectedEvidenceJson: text("expected_evidence_json").notNull(),
  createdAt: text("created_at").notNull()
}, (table) => [
  check("ck_gate_criteria_json", sql`json_valid(${table.criteriaJson})`),
  check("ck_gate_expected_evidence_json", sql`json_valid(${table.expectedEvidenceJson})`)
]);

export const gateBindings = sqliteTable("gate_binding", {
  id: text("id").primaryKey(),
  gateId: text("gate_id").notNull().references(() => gateDefinitions.id),
  pipelineEdgeId: text("pipeline_edge_id").references(() => pipelineEdges.id),
  pipelineNodeId: text("pipeline_node_id").references(() => pipelineNodes.id),
  missionId: text("mission_id").references(() => missions.id)
}, (table) => [check("ck_gate_binding_subject", sql`(${table.pipelineEdgeId} is not null and ${table.pipelineNodeId} is null and ${table.missionId} is null) or (${table.pipelineEdgeId} is null and ${table.pipelineNodeId} is not null and ${table.missionId} is null) or (${table.pipelineEdgeId} is null and ${table.pipelineNodeId} is null and ${table.missionId} is not null)`)]);

export const evidence = sqliteTable("evidence", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  kind: text("kind", { enum: ["declaration", "observation", "validation"] }).notNull(),
  subjectDigest: text("subject_digest").notNull(),
  collectorId: text("collector_id").notNull(),
  collectorVersion: text("collector_version").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: text("created_at").notNull()
}, (table) => [
  check("ck_evidence_kind", sql`${table.kind} in ('declaration','observation','validation')`),
  check("ck_evidence_payload", sql`json_valid(${table.payloadJson})`)
]);

export const evidenceBlobs = sqliteTable("evidence_blob", {
  evidenceId: text("evidence_id").notNull().references(() => evidence.id),
  blobId: text("blob_id").notNull().references(() => blobs.id),
  role: text("role", { enum: ["stdout", "stderr", "report", "output", "other"] }).notNull()
}, (table) => [
  primaryKey({ columns: [table.evidenceId, table.blobId, table.role] }),
  check("ck_evidence_blob_role", sql`${table.role} in ('stdout','stderr','report','output','other')`)
]);

export const artifacts = sqliteTable("artifact", {
  id: text("id").primaryKey(),
  blobId: text("blob_id").notNull().unique().references(() => blobs.id),
  evidenceId: text("evidence_id").references(() => evidence.id),
  artifactKind: text("artifact_kind").notNull(),
  createdAt: text("created_at").notNull()
});

export const gateEvaluations = sqliteTable("gate_evaluation", {
  id: text("id").primaryKey(),
  gateBindingId: text("gate_binding_id").notNull().references(() => gateBindings.id),
  runId: text("run_id").references(() => runs.id),
  evaluatorId: text("evaluator_id").notNull(),
  evaluatorVersion: text("evaluator_version").notNull(),
  state: text("state", { enum: ["pending", "passed", "failed", "stale", "overridden"] }).notNull(),
  evaluatedAt: text("evaluated_at").notNull(),
  staleAt: text("stale_at"),
  rationale: text("rationale")
}, (table) => [
  check("ck_gate_evaluation_state", sql`${table.state} in ('pending','passed','failed','stale','overridden')`),
  index("idx_gate_evaluation").on(table.gateBindingId, table.state, table.evaluatedAt)
]);

export const gateEvaluationEvidence = sqliteTable("gate_evaluation_evidence", {
  evaluationId: text("evaluation_id").notNull().references(() => gateEvaluations.id),
  evidenceId: text("evidence_id").notNull().references(() => evidence.id),
  role: text("role").notNull()
}, (table) => [primaryKey({ columns: [table.evaluationId, table.evidenceId] })]);
