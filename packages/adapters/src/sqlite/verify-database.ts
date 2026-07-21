import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";

const REQUIRED_TABLES = [
  "app_config",
  "mission",
  "run",
  "pipeline",
  "provider_event",
  "search_document",
  "schema_migration"
] as const;

const REQUIRED_TRIGGERS = [
  "run_subject_matches_conversation",
  "mcp_owner_exists",
  "mcp_owner_update_exists",
  "mcp_member_owner_exists",
  "mcp_member_owner_update_exists",
  "published_pipeline_immutable",
  "published_pipeline_not_deleted",
  "pipeline_edge_same_definition",
  "pipeline_run_definition_matches",
  "pipeline_node_run_definition_matches",
  "manager_current_instruction_exists",
  "manager_ready_requires_instruction",
  "mission_config_only_for_agent"
] as const;

export interface DatabaseVerification {
  foreignKeys: true;
  journalMode: "wal";
  migrationVersion: 1;
  requiredTables: string[];
  requiredTriggers: string[];
}

export const verifyDatabase = (database: NodraSqliteDatabase): DatabaseVerification => {
  const foreignKeys = database.connection.pragma("foreign_keys", { simple: true });
  if (foreignKeys !== 1) throw new Error("SQLite foreign keys are not enabled");
  const journalMode = String(database.connection.pragma("journal_mode", { simple: true })).toLowerCase();
  if (journalMode !== "wal") throw new Error(`SQLite journal mode is ${journalMode}, expected WAL`);
  const violations = database.connection.pragma("foreign_key_check") as unknown[];
  if (violations.length) throw new Error(`SQLite foreign_key_check returned ${violations.length} violation(s)`);
  const tables = new Set(
    (database.connection.prepare("select name from sqlite_master where type in ('table','view')").all() as Array<{ name: string }>).map(
      ({ name }) => name
    )
  );
  const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
  if (missing.length) throw new Error(`Missing required SQLite objects: ${missing.join(", ")}`);
  const triggers = new Set(
    (database.connection.prepare("select name from sqlite_master where type = 'trigger'").all() as Array<{ name: string }>).map(
      ({ name }) => name
    )
  );
  const missingTriggers = REQUIRED_TRIGGERS.filter((trigger) => !triggers.has(trigger));
  if (missingTriggers.length) throw new Error(`Missing required SQLite triggers: ${missingTriggers.join(", ")}`);
  const migration = database.connection.prepare("select version from schema_migration where version = 1").get() as
    | { version: number }
    | undefined;
  if (migration?.version !== 1) throw new Error("Nodra baseline migration is not registered");
  return {
    foreignKeys: true,
    journalMode: "wal",
    migrationVersion: 1,
    requiredTables: [...REQUIRED_TABLES],
    requiredTriggers: [...REQUIRED_TRIGGERS]
  };
};
