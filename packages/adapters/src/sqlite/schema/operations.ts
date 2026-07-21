import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { pipelineRuns } from "./pipelines.js";
import { missions } from "./missions.js";

export const relayItems = sqliteTable("relay_item", {
  id: text("id").primaryKey(),
  missionId: text("mission_id").references(() => missions.id),
  pipelineRunId: text("pipeline_run_id").references(() => pipelineRuns.id),
  queue: text("queue", { enum: ["ready", "active", "blocked", "decision_required"] }).notNull(),
  state: text("state", { enum: ["unread", "read", "snoozed", "resolved"] }).notNull(),
  reasonCode: text("reason_code").notNull(),
  createdAt: text("created_at").notNull(),
  readAt: text("read_at"),
  snoozedUntil: text("snoozed_until"),
  resolvedAt: text("resolved_at")
}, (table) => [
  check("ck_relay_queue", sql`${table.queue} in ('ready','active','blocked','decision_required')`),
  check("ck_relay_state", sql`${table.state} in ('unread','read','snoozed','resolved')`),
  check("ck_relay_subject", sql`(${table.missionId} is not null and ${table.pipelineRunId} is null) or (${table.missionId} is null and ${table.pipelineRunId} is not null)`),
  index("idx_relay_queue").on(table.queue, table.state, table.snoozedUntil, table.createdAt)
]);

export const businessAuditEvents = sqliteTable("business_audit_event", {
  id: text("id").primaryKey(),
  aggregateKind: text("aggregate_kind").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  commandId: text("command_id"),
  eventType: text("event_type").notNull(),
  actor: text("actor").notNull(),
  payloadJson: text("payload_json").notNull(),
  occurredAt: text("occurred_at").notNull()
}, (table) => [
  check("ck_business_audit_payload", sql`json_valid(${table.payloadJson})`),
  index("idx_audit_aggregate").on(table.aggregateKind, table.aggregateId, table.occurredAt)
]);

export const outbox = sqliteTable("outbox", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  payloadJson: text("payload_json").notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  createdAt: text("created_at").notNull(),
  publishedAt: text("published_at")
}, (table) => [check("ck_outbox_payload", sql`json_valid(${table.payloadJson})`)]);

export const inbox = sqliteTable("inbox", {
  consumer: text("consumer").notNull(),
  messageId: text("message_id").notNull(),
  processedAt: text("processed_at").notNull()
}, (table) => [primaryKey({ columns: [table.consumer, table.messageId] })]);

export const retentionPolicies = sqliteTable("retention_policy", {
  id: integer("id").primaryKey(),
  automaticPurgeEnabled: integer("automatic_purge_enabled").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
}, (table) => [
  check("ck_retention_policy_singleton", sql`${table.id} = 1`),
  check("ck_retention_no_auto_purge", sql`${table.automaticPurgeEnabled} = 0`)
]);

export const retentionTombstones = sqliteTable("retention_tombstone", {
  id: text("id").primaryKey(),
  entityKind: text("entity_kind").notNull(),
  entityId: text("entity_id").notNull(),
  deletedAt: text("deleted_at").notNull(),
  restoredAt: text("restored_at"),
  purgeRequestedAt: text("purge_requested_at"),
  purgedAt: text("purged_at"),
  purgeState: text("purge_state", { enum: ["soft_deleted", "restored", "purged"] }).notNull()
}, (table) => [check("ck_retention_purge_state", sql`${table.purgeState} in ('soft_deleted','restored','purged')`)]);

export const searchDocumentRegistry = sqliteTable("search_document_registry", {
  entityKind: text("entity_kind").notNull(),
  entityId: text("entity_id").notNull()
}, (table) => [primaryKey({ columns: [table.entityKind, table.entityId] })]);
