import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { blobs, projects, workspaces } from "./core.js";

export const missions = sqliteTable("mission", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id),
  title: text("title").notNull(),
  executionKind: text("execution_kind", { enum: ["human", "agent"] }).notNull(),
  state: text("state", { enum: ["DRAFT", "READY", "ACTIVE", "BLOCKED", "VALIDATION", "DONE", "ABANDONED"] }).notNull(),
  version: integer("version").notNull().default(0),
  temporalParentWorkflowId: text("temporal_parent_workflow_id").unique(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at")
}, (table) => [
  check("ck_mission_title", sql`length(trim(${table.title})) > 0`),
  check("ck_mission_execution_kind", sql`${table.executionKind} in ('human','agent')`),
  check("ck_mission_state", sql`${table.state} in ('DRAFT','READY','ACTIVE','BLOCKED','VALIDATION','DONE','ABANDONED')`),
  check("ck_mission_version", sql`${table.version} >= 0`),
  index("idx_mission_relay").on(table.state, table.updatedAt)
]);

export const missionAgentConfigs = sqliteTable("mission_agent_config", {
  missionId: text("mission_id").primaryKey().references(() => missions.id),
  version: integer("version").notNull().default(0),
  providerId: text("provider_id"),
  modelId: text("model_id"),
  reasoningEffort: text("reasoning_effort"),
  providerOptionsSchemaVersion: integer("provider_options_schema_version").notNull().default(1),
  providerOptionsJson: text("provider_options_json").notNull().default("{}"),
  missionPrompt: text("mission_prompt").notNull().default(""),
  permissionPreset: text("permission_preset", { enum: ["read_only", "workspace", "full_access"] }),
  workspaceId: text("workspace_id").references(() => workspaces.id),
  autoCommitAuthorized: integer("auto_commit_authorized").notNull().default(0),
  integrationTargetRef: text("integration_target_ref"),
  updatedAt: text("updated_at").notNull()
}, (table) => [
  check("ck_mission_agent_config_version", sql`${table.version} >= 0`),
  check("ck_mission_agent_config_json", sql`json_valid(${table.providerOptionsJson})`),
  check("ck_mission_agent_config_permission", sql`${table.permissionPreset} is null or ${table.permissionPreset} in ('read_only','workspace','full_access')`),
  check("ck_mission_auto_commit", sql`${table.autoCommitAuthorized} in (0,1)`)
]);

export const missionInputAttachments = sqliteTable("mission_input_attachment", {
  missionId: text("mission_id").notNull().references(() => missions.id),
  ordinal: integer("ordinal").notNull(),
  blobId: text("blob_id").notNull().references(() => blobs.id),
  displayName: text("display_name").notNull()
}, (table) => [
  primaryKey({ columns: [table.missionId, table.ordinal] }),
  check("ck_mission_attachment_ordinal", sql`${table.ordinal} >= 0`)
]);
