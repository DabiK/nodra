import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { conversations } from "./conversations.js";
import { blobs, workspaces } from "./core.js";
import { managers } from "./managers.js";
import { missions } from "./missions.js";

export const runs = sqliteTable("run", {
  id: text("id").primaryKey(),
  missionId: text("mission_id").references(() => missions.id),
  managerId: text("manager_id").references(() => managers.id),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  userAttempt: integer("user_attempt").notNull(),
  state: text("state", { enum: ["QUEUED", "STARTING", "RUNNING", "WAITING_APPROVAL", "CANCELLING", "SUCCEEDED", "FAILED", "CANCELLED", "UNKNOWN"] }).notNull(),
  temporalWorkflowId: text("temporal_workflow_id").notNull().unique(),
  temporalRunId: text("temporal_run_id"),
  providerId: text("provider_id").notNull(),
  modelId: text("model_id").notNull(),
  reasoningEffort: text("reasoning_effort"),
  providerRunRef: text("provider_run_ref"),
  startedAt: text("started_at"),
  endedAt: text("ended_at"),
  durationMs: integer("duration_ms"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  cacheWriteTokens: integer("cache_write_tokens"),
  costMicros: integer("cost_micros"),
  usageKind: text("usage_kind", { enum: ["reported", "estimated", "unavailable"] }),
  pricingSnapshotJson: text("pricing_snapshot_json"),
  createdAt: text("created_at").notNull()
}, (table) => [
  check("ck_run_attempt", sql`${table.userAttempt} > 0`),
  check("ck_run_state", sql`${table.state} in ('QUEUED','STARTING','RUNNING','WAITING_APPROVAL','CANCELLING','SUCCEEDED','FAILED','CANCELLED','UNKNOWN')`),
  check("ck_run_subject", sql`(${table.missionId} is not null and ${table.managerId} is null) or (${table.missionId} is null and ${table.managerId} is not null)`),
  check("ck_run_duration", sql`${table.durationMs} is null or ${table.durationMs} >= 0`),
  check("ck_run_input_tokens", sql`${table.inputTokens} is null or ${table.inputTokens} >= 0`),
  check("ck_run_output_tokens", sql`${table.outputTokens} is null or ${table.outputTokens} >= 0`),
  check("ck_run_cache_read", sql`${table.cacheReadTokens} is null or ${table.cacheReadTokens} >= 0`),
  check("ck_run_cache_write", sql`${table.cacheWriteTokens} is null or ${table.cacheWriteTokens} >= 0`),
  check("ck_run_cost", sql`${table.costMicros} is null or ${table.costMicros} >= 0`),
  check("ck_run_usage_kind", sql`${table.usageKind} is null or ${table.usageKind} in ('reported','estimated','unavailable')`),
  check("ck_run_pricing_json", sql`${table.pricingSnapshotJson} is null or json_valid(${table.pricingSnapshotJson})`),
  uniqueIndex("ux_run_mission_attempt").on(table.missionId, table.userAttempt),
  uniqueIndex("ux_run_manager_attempt").on(table.managerId, table.userAttempt),
  index("idx_run_subject").on(table.missionId, table.managerId, table.createdAt),
  index("idx_run_provider_model").on(table.providerId, table.modelId, table.reasoningEffort, table.createdAt)
]);

export const runConfigSnapshots = sqliteTable("run_config_snapshot", {
  runId: text("run_id").primaryKey().references(() => runs.id),
  resolutionSchemaVersion: integer("resolution_schema_version").notNull(),
  providerIdRequested: text("provider_id_requested").notNull(),
  providerIdResolved: text("provider_id_resolved").notNull(),
  modelIdRequested: text("model_id_requested"),
  modelIdResolved: text("model_id_resolved").notNull(),
  reasoningEffortRequested: text("reasoning_effort_requested"),
  reasoningEffortResolved: text("reasoning_effort_resolved"),
  providerOptionsSchemaVersion: integer("provider_options_schema_version").notNull(),
  providerOptionsJson: text("provider_options_json").notNull(),
  providerCapabilitiesJson: text("provider_capabilities_json").notNull(),
  promptKind: text("prompt_kind", { enum: ["mission", "manager"] }).notNull(),
  promptCompositionSchemaVersion: integer("prompt_composition_schema_version").notNull(),
  promptEffective: text("prompt_effective").notNull(),
  promptGlobal: text("prompt_global"),
  promptManagerInstruction: text("prompt_manager_instruction"),
  promptMission: text("prompt_mission"),
  promptBrief: text("prompt_brief"),
  permissionPreset: text("permission_preset", { enum: ["read_only", "workspace", "full_access"] }).notNull(),
  budgetSnapshotJson: text("budget_snapshot_json").notNull(),
  workspaceId: text("workspace_id").references(() => workspaces.id),
  cwd: text("cwd").notNull(),
  gitHead: text("git_head"),
  gitTree: text("git_tree"),
  createdAt: text("created_at").notNull()
}, (table) => [
  check("ck_run_config_options_json", sql`json_valid(${table.providerOptionsJson})`),
  check("ck_run_config_capabilities_json", sql`json_valid(${table.providerCapabilitiesJson})`),
  check("ck_run_config_prompt_kind", sql`${table.promptKind} in ('mission','manager')`),
  check("ck_run_config_permission", sql`${table.permissionPreset} in ('read_only','workspace','full_access')`),
  check("ck_run_config_budget_json", sql`json_valid(${table.budgetSnapshotJson})`)
]);

export const runSnapshotMcp = sqliteTable("run_snapshot_mcp", {
  runId: text("run_id").notNull().references(() => runs.id),
  mcpId: text("mcp_id").notNull(),
  configDigest: text("config_digest").notNull(),
  transportKind: text("transport_kind").notNull()
}, (table) => [
  primaryKey({ columns: [table.runId, table.mcpId] }),
  check("ck_run_mcp_digest", sql`length(${table.configDigest}) = 64`)
]);

export const runInputSnapshotAttachments = sqliteTable("run_input_snapshot_attachment", {
  runId: text("run_id").notNull().references(() => runs.id),
  ordinal: integer("ordinal").notNull(),
  blobId: text("blob_id").notNull().references(() => blobs.id),
  displayName: text("display_name").notNull()
}, (table) => [
  primaryKey({ columns: [table.runId, table.ordinal] }),
  check("ck_run_attachment_ordinal", sql`${table.ordinal} >= 0`)
]);
