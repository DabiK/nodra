import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { blobs, projects, workspaces } from "./core.js";

export const managers = sqliteTable("manager", {
  id: text("id").primaryKey(),
  name: text("name"),
  projectId: text("project_id").references(() => projects.id),
  state: text("state", { enum: ["draft", "ready", "active", "blocked", "archived"] }).notNull(),
  temporalParentWorkflowId: text("temporal_parent_workflow_id").unique(),
  providerId: text("provider_id"),
  modelId: text("model_id"),
  reasoningEffort: text("reasoning_effort"),
  providerOptionsSchemaVersion: integer("provider_options_schema_version").notNull().default(1),
  providerOptionsJson: text("provider_options_json").notNull().default("{}"),
  permissionPreset: text("permission_preset", { enum: ["read_only", "workspace", "full_access"] }).notNull().default("full_access"),
  workspaceId: text("workspace_id").references(() => workspaces.id),
  createdAt: text("created_at").notNull(),
  archivedAt: text("archived_at")
}, (table) => [
  check("ck_manager_state", sql`${table.state} in ('draft','ready','active','blocked','archived')`),
  check("ck_manager_options_json", sql`json_valid(${table.providerOptionsJson})`),
  check("ck_manager_permission", sql`${table.permissionPreset} in ('read_only','workspace','full_access')`)
]);

export const managerInstructionVersions = sqliteTable("manager_instruction_version", {
  managerId: text("manager_id").notNull().references(() => managers.id),
  version: integer("version").notNull(),
  instruction: text("instruction").notNull(),
  isCurrent: integer("is_current").notNull(),
  createdAt: text("created_at").notNull()
}, (table) => [
  primaryKey({ columns: [table.managerId, table.version] }),
  check("ck_manager_instruction_current", sql`${table.isCurrent} in (0,1)`),
  uniqueIndex("ux_manager_current_instruction").on(table.managerId).where(sql`${table.isCurrent} = 1`)
]);

export const managerBriefs = sqliteTable("manager_brief", {
  id: text("id").primaryKey(),
  managerId: text("manager_id").notNull().references(() => managers.id),
  version: integer("version").notNull(),
  content: text("content").notNull(),
  status: text("status", { enum: ["current", "superseded"] }).notNull(),
  createdAt: text("created_at").notNull()
}, (table) => [
  check("ck_manager_brief_status", sql`${table.status} in ('current','superseded')`),
  uniqueIndex("ux_manager_brief_version").on(table.managerId, table.version)
]);

export const managerInputAttachments = sqliteTable("manager_input_attachment", {
  managerId: text("manager_id").notNull().references(() => managers.id),
  ordinal: integer("ordinal").notNull(),
  blobId: text("blob_id").notNull().references(() => blobs.id),
  displayName: text("display_name").notNull()
}, (table) => [
  primaryKey({ columns: [table.managerId, table.ordinal] }),
  check("ck_manager_attachment_ordinal", sql`${table.ordinal} >= 0`)
]);
