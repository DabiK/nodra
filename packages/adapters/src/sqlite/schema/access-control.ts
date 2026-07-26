import { sql } from "drizzle-orm";
import { check, index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { approvals } from "./approvals.js";
import { missions } from "./missions.js";
import { runs } from "./runs.js";
import { workspaces } from "./core.js";

export const mcpSelections = sqliteTable("mcp_selection", {
  ownerKind: text("owner_kind", { enum: ["global", "project", "mission", "manager"] }).notNull(),
  ownerId: text("owner_id").notNull(),
  selectionMode: text("selection_mode", { enum: ["all", "none", "custom", "inherit"] }).notNull()
}, (table) => [
  primaryKey({ columns: [table.ownerKind, table.ownerId] }),
  check("ck_mcp_selection_owner", sql`${table.ownerKind} in ('global','project','mission','manager')`),
  check("ck_mcp_selection_mode", sql`${table.selectionMode} in ('all','none','custom','inherit')`)
]);

export const mcpSelectionMembers = sqliteTable("mcp_selection_member", {
  ownerKind: text("owner_kind").notNull(),
  ownerId: text("owner_id").notNull(),
  mcpId: text("mcp_id").notNull(),
  mode: text("mode", { enum: ["enable", "disable"] }).notNull(),
  configDigest: text("config_digest")
}, (table) => [
  primaryKey({ columns: [table.ownerKind, table.ownerId, table.mcpId] }),
  check("ck_mcp_member_mode", sql`${table.mode} in ('enable','disable')`),
  check("ck_mcp_member_digest", sql`${table.configDigest} is null or length(${table.configDigest}) = 64`)
]);

export const permissionGrants = sqliteTable("permission_grant", {
  id: text("id").primaryKey(),
  approvalId: text("approval_id").notNull().references(() => approvals.id),
  actionKind: text("action_kind").notNull(),
  targetDigest: text("target_digest").notNull(),
  scope: text("scope", { enum: ["once", "run", "mission"] }).notNull(),
  runId: text("run_id").references(() => runs.id),
  missionId: text("mission_id").references(() => missions.id),
  expiresAt: text("expires_at"),
  decision: text("decision", { enum: ["approved", "denied"] }).notNull(),
  consumedAt: text("consumed_at"),
  consumedByEventId: text("consumed_by_event_id"),
  createdAt: text("created_at").notNull()
}, (table) => [
  check("ck_permission_target_digest", sql`length(${table.targetDigest}) = 64`),
  check("ck_permission_scope", sql`${table.scope} in ('once','run','mission')`),
  check("ck_permission_decision", sql`${table.decision} in ('approved','denied')`),
  check("ck_permission_subject", sql`((${table.scope} in ('once','run')) and ${table.runId} is not null and ${table.missionId} is null) or (${table.scope} = 'mission' and ${table.missionId} is not null and ${table.runId} is null)`)
]);

export const confirmations = sqliteTable("confirmation", {
  id: text("id").primaryKey(),
  action: text("action").notNull(),
  targetJson: text("target_json").notNull(),
  targetDigest: text("target_digest").notNull(),
  cwd: text("cwd"),
  providerId: text("provider_id"),
  permissionPreset: text("permission_preset", { enum: ["read_only", "workspace", "full_access"] }),
  risk: text("risk").notNull(),
  scope: text("scope", { enum: ["once", "run", "mission"] }).notNull(),
  runId: text("run_id").references(() => runs.id),
  missionId: text("mission_id").references(() => missions.id),
  workspaceId: text("workspace_id").references(() => workspaces.id),
  expiresAt: text("expires_at").notNull(),
  state: text("state", { enum: ["pending", "approved", "denied", "expired", "consumed"] }).notNull(),
  decidedBy: text("decided_by"),
  comment: text("comment"),
  createdAt: text("created_at").notNull(),
  decidedAt: text("decided_at"),
  consumedAt: text("consumed_at")
}, (table) => [
  check("ck_confirmation_target_digest", sql`length(${table.targetDigest}) = 64`),
  check("ck_confirmation_target_json", sql`json_valid(${table.targetJson})`),
  check("ck_confirmation_scope", sql`${table.scope} in ('once','run','mission')`),
  check("ck_confirmation_state", sql`${table.state} in ('pending','approved','denied','expired','consumed')`),
  check("ck_confirmation_subject", sql`(${table.scope} = 'once' and ((${table.runId} is not null)+(${table.missionId} is not null)+(${table.workspaceId} is not null)) = 1) or (${table.scope} = 'run' and ${table.runId} is not null and ${table.missionId} is null and ${table.workspaceId} is null) or (${table.scope} = 'mission' and ${table.missionId} is not null and ${table.runId} is null and ${table.workspaceId} is null)`),
  index("idx_confirmation_state_expires").on(table.state, table.expiresAt),
  index("idx_confirmation_run").on(table.runId, table.action, table.state),
  index("idx_confirmation_mission").on(table.missionId, table.action, table.state),
  index("idx_confirmation_workspace").on(table.workspaceId, table.action, table.state)
]);
