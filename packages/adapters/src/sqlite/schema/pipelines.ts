import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { projects } from "./core.js";
import { runs } from "./runs.js";
import { managers } from "./managers.js";
import { missions } from "./missions.js";

export const pipelines = sqliteTable(
  "pipeline",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").references(() => projects.id),
    name: text("name").notNull(),
    state: text("state", { enum: ["draft", "active", "completed", "archived"] }).notNull(),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
    archivedAt: text("archived_at")
  },
  (table) => [check("ck_pipeline_state", sql`${table.state} in ('draft','active','completed','archived')`)]
);

export const managerSupervisions = sqliteTable(
  "manager_supervision",
  {
    id: text("id").primaryKey(),
    managerId: text("manager_id").notNull().references(() => managers.id),
    missionId: text("mission_id").references(() => missions.id),
    pipelineId: text("pipeline_id").references(() => pipelines.id),
    relation: text("relation", { enum: ["created", "supervises"] }).notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    check("ck_manager_supervision_relation", sql`${table.relation} in ('created','supervises')`),
    check("ck_manager_supervision_subject", sql`(${table.missionId} is not null and ${table.pipelineId} is null) or (${table.missionId} is null and ${table.pipelineId} is not null)`)
  ]
);

export const pipelineDefinitions = sqliteTable("pipeline_definition", {
  id: text("id").primaryKey(),
  pipelineId: text("pipeline_id").notNull().references(() => pipelines.id),
  version: integer("version").notNull(),
  definitionState: text("definition_state", { enum: ["draft", "published", "superseded"] }).notNull(),
  createdAt: text("created_at").notNull()
}, (table) => [
  check("ck_pipeline_definition_state", sql`${table.definitionState} in ('draft','published','superseded')`),
  uniqueIndex("ux_pipeline_definition_version").on(table.pipelineId, table.version)
]);

export const pipelineNodes = sqliteTable("pipeline_node", {
  id: text("id").primaryKey(),
  definitionId: text("definition_id").notNull().references(() => pipelineDefinitions.id),
  missionId: text("mission_id").references(() => missions.id),
  nodeKey: text("node_key").notNull(),
  startMode: text("start_mode", { enum: ["auto", "human"] }).notNull()
}, (table) => [
  check("ck_pipeline_node_start_mode", sql`${table.startMode} in ('auto','human')`),
  uniqueIndex("ux_pipeline_node_key").on(table.definitionId, table.nodeKey)
]);

export const pipelineEdges = sqliteTable("pipeline_edge", {
  id: text("id").primaryKey(),
  definitionId: text("definition_id").notNull().references(() => pipelineDefinitions.id),
  fromNodeId: text("from_node_id").notNull().references(() => pipelineNodes.id),
  toNodeId: text("to_node_id").notNull().references(() => pipelineNodes.id)
}, (table) => [
  check("ck_pipeline_edge_distinct", sql`${table.fromNodeId} <> ${table.toNodeId}`),
  uniqueIndex("ux_pipeline_edge").on(table.definitionId, table.fromNodeId, table.toNodeId)
]);

export const pipelineRuns = sqliteTable(
  "pipeline_run",
  {
    id: text("id").primaryKey(),
    pipelineId: text("pipeline_id").notNull().references(() => pipelines.id),
    definitionId: text("definition_id").notNull().references(() => pipelineDefinitions.id),
    state: text("state", { enum: ["queued", "active", "blocked", "completed", "failed", "cancelled", "archived"] }).notNull(),
    temporalWorkflowId: text("temporal_workflow_id").unique(),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
    createdAt: text("created_at").notNull()
  },
  (table) => [check("ck_pipeline_run_state", sql`${table.state} in ('queued','active','blocked','completed','failed','cancelled','archived')`)]
);

export const pipelineNodeRuns = sqliteTable("pipeline_node_run", {
  id: text("id").primaryKey(),
  pipelineRunId: text("pipeline_run_id").notNull().references(() => pipelineRuns.id),
  nodeId: text("node_id").notNull().references(() => pipelineNodes.id),
  missionId: text("mission_id").references(() => missions.id),
  state: text("state", { enum: ["pending", "ready", "active", "blocked", "completed", "failed", "skipped"] }).notNull(),
  userAttempt: integer("user_attempt").notNull().default(1)
}, (table) => [
  check("ck_pipeline_node_run_state", sql`${table.state} in ('pending','ready','active','blocked','completed','failed','skipped')`),
  uniqueIndex("ux_pipeline_node_run_attempt").on(table.pipelineRunId, table.nodeId, table.userAttempt)
]);

export const handovers = sqliteTable("handover", {
  id: text("id").primaryKey(),
  pipelineNodeRunId: text("pipeline_node_run_id").notNull().references(() => pipelineNodeRuns.id),
  fromRunId: text("from_run_id").references(() => runs.id),
  toNodeRunId: text("to_node_run_id").notNull().references(() => pipelineNodeRuns.id),
  payloadJson: text("payload_json").notNull(),
  createdAt: text("created_at").notNull()
}, (table) => [check("ck_handover_payload", sql`json_valid(${table.payloadJson})`)]);

export const targetedRetries = sqliteTable("targeted_retry", {
  id: text("id").primaryKey(),
  pipelineNodeRunId: text("pipeline_node_run_id").notNull().references(() => pipelineNodeRuns.id),
  priorRunId: text("prior_run_id").references(() => runs.id),
  newRunId: text("new_run_id").references(() => runs.id),
  requestedBy: text("requested_by").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull()
});
