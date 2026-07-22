import { sql } from "drizzle-orm";
import { check, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { gateEvaluations } from "./gates.js";
import { managers } from "./managers.js";
import { missions } from "./missions.js";
import { runs } from "./runs.js";

export const approvals = sqliteTable("approval", {
  id: text("id").primaryKey(),
  runId: text("run_id").references(() => runs.id),
  missionId: text("mission_id").references(() => missions.id),
  managerId: text("manager_id").references(() => managers.id),
  kind: text("kind").notNull(),
  state: text("state", { enum: ["pending", "approved", "denied", "expired"] }).notNull(),
  expiresAt: text("expires_at"),
  decidedAt: text("decided_at"),
  decidedBy: text("decided_by"),
  decisionComment: text("decision_comment"),
  createdAt: text("created_at").notNull()
}, (table) => [
  check("ck_approval_state", sql`${table.state} in ('pending','approved','denied','expired')`),
  check("ck_approval_subject", sql`((${table.runId} is not null) + (${table.missionId} is not null) + (${table.managerId} is not null)) = 1`)
]);

export const managerCreationRequests = sqliteTable("manager_creation_request", {
  id: text("id").primaryKey(),
  parentManagerId: text("parent_manager_id").notNull().references(() => managers.id),
  childManagerId: text("child_manager_id").references(() => managers.id),
  approvalId: text("approval_id").references(() => approvals.id),
  state: text("state", { enum: ["pending", "approved", "denied", "created"] }).notNull(),
  createdAt: text("created_at").notNull()
}, (table) => [check("ck_manager_creation_state", sql`${table.state} in ('pending','approved','denied','created')`)]);

export const gateOverrides = sqliteTable("gate_override", {
  id: text("id").primaryKey(),
  evaluationId: text("evaluation_id").notNull().references(() => gateEvaluations.id),
  approvalId: text("approval_id").notNull().references(() => approvals.id),
  decision: text("decision", { enum: ["accept", "reject", "waive"] }).notNull(),
  comment: text("comment").notNull(),
  createdAt: text("created_at").notNull()
}, (table) => [check("ck_gate_override_decision", sql`${table.decision} in ('accept','reject','waive')`)]);

export const runDeliveries = sqliteTable("run_delivery", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().unique().references(() => runs.id),
  agentDeclaration: text("agent_declaration"),
  observationSummary: text("observation_summary"),
  resultState: text("result_state", { enum: ["pending", "delivered", "accepted", "changes_requested", "rejected"] }).notNull(),
  acceptedAt: text("accepted_at"),
  decisionComment: text("decision_comment"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
}, (table) => [check("ck_run_delivery_state", sql`${table.resultState} in ('pending','delivered','accepted','changes_requested','rejected')`)]);
