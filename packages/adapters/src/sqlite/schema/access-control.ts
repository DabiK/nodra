import { sql } from "drizzle-orm";
import { check, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { approvals } from "./approvals.js";
import { missions } from "./missions.js";
import { runs } from "./runs.js";

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
