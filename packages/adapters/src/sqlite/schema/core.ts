import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const schemaMigration = sqliteTable("schema_migration", {
  version: integer("version").primaryKey(),
  checksum: text("checksum").notNull().unique(),
  appliedAt: text("applied_at").notNull()
});

export const appConfig = sqliteTable(
  "app_config",
  {
    id: integer("id").primaryKey(),
    globalManagerPrompt: text("global_manager_prompt").notNull().default(""),
    promptCompositionSchemaVersion: integer("prompt_composition_schema_version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [check("ck_app_config_singleton", sql`${table.id} = 1`)]
);

export const repositories = sqliteTable("repository", {
  id: text("id").primaryKey(),
  stableIdentity: text("stable_identity").notNull().unique(),
  canonicalRemote: text("canonical_remote"),
  initialPath: text("initial_path").notNull(),
  currentPath: text("current_path").notNull(),
  discoveredAt: text("discovered_at").notNull(),
  movedAt: text("moved_at")
});

export const projects = sqliteTable("project", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["repo", "scratch"] }).notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
}, (table) => [check("ck_project_kind", sql`${table.kind} in ('repo','scratch')`)]);

export const projectRepositories = sqliteTable("project_repository", {
  projectId: text("project_id").primaryKey().references(() => projects.id),
  repositoryId: text("repository_id").notNull().unique().references(() => repositories.id)
});

export const projectAgentDefaults = sqliteTable(
  "project_agent_defaults",
  {
    projectId: text("project_id").primaryKey().references(() => projects.id),
    providerId: text("provider_id"),
    modelId: text("model_id"),
    reasoningEffort: text("reasoning_effort"),
    providerOptionsSchemaVersion: integer("provider_options_schema_version").notNull().default(1),
    providerOptionsJson: text("provider_options_json").notNull().default("{}"),
    permissionPreset: text("permission_preset", { enum: ["read_only", "workspace", "full_access"] }).notNull().default("full_access"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    check("ck_project_defaults_json", sql`json_valid(${table.providerOptionsJson})`),
    check("ck_project_defaults_permission", sql`${table.permissionPreset} in ('read_only','workspace','full_access')`)
  ]
);

export const blobs = sqliteTable(
  "blob",
  {
    id: text("id").primaryKey(),
    sha256: text("sha256").notNull().unique(),
    relativePath: text("relative_path").notNull().unique(),
    mimeType: text("mime_type"),
    byteSize: integer("byte_size").notNull(),
    createdAt: text("created_at").notNull(),
    tombstonedAt: text("tombstoned_at")
  },
  (table) => [
    check("ck_blob_sha256", sql`length(${table.sha256}) = 64`),
    check("ck_blob_byte_size", sql`${table.byteSize} >= 0`)
  ]
);

export const workspaces = sqliteTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").references(() => projects.id),
    kind: text("kind", { enum: ["repo", "scratch", "worktree"] }).notNull(),
    path: text("path").notNull().unique(),
    state: text("state", { enum: ["ready", "in_use", "pending_delete", "deleted"] }).notNull(),
    createdAt: text("created_at").notNull(),
    tombstonedAt: text("tombstoned_at")
  },
  (table) => [
    check("ck_workspace_kind", sql`${table.kind} in ('repo','scratch','worktree')`),
    check("ck_workspace_state", sql`${table.state} in ('ready','in_use','pending_delete','deleted')`)
  ]
);

export const workspaceRepositories = sqliteTable("workspace_repository", {
  workspaceId: text("workspace_id").primaryKey().references(() => workspaces.id),
  repositoryId: text("repository_id").notNull().references(() => repositories.id),
  baseRef: text("base_ref"),
  headRef: text("head_ref"),
  branchName: text("branch_name"),
  integrationTargetRef: text("integration_target_ref"),
  tombstonedAt: text("tombstoned_at")
});

export const workspaceGitSnapshots = sqliteTable("workspace_git_snapshot", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  reason: text("reason").notNull(),
  head: text("head"),
  treeDigest: text("tree_digest"),
  branchName: text("branch_name"),
  capturedAt: text("captured_at").notNull()
}, (table) => [index("idx_workspace_git_snapshot").on(table.workspaceId, table.capturedAt)]);
