import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { blobs } from "./core.js";
import { managers } from "./managers.js";
import { missions } from "./missions.js";

export const conversations = sqliteTable("conversation", {
  id: text("id").primaryKey(),
  missionId: text("mission_id").references(() => missions.id),
  managerId: text("manager_id").references(() => managers.id),
  providerId: text("provider_id").notNull(),
  providerSessionRef: text("provider_session_ref"),
  state: text("state", { enum: ["open", "idle", "closed", "deleted"] }).notNull(),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at")
}, (table) => [
  check("ck_conversation_subject", sql`(${table.missionId} is not null and ${table.managerId} is null) or (${table.missionId} is null and ${table.managerId} is not null)`),
  check("ck_conversation_state", sql`${table.state} in ('open','idle','closed','deleted')`)
]);

export const conversationItems = sqliteTable("conversation_item", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  ordinal: integer("ordinal").notNull(),
  kind: text("kind", { enum: ["user", "assistant", "tool", "system", "steer", "result"] }).notNull(),
  deliveryState: text("delivery_state", { enum: ["draft", "queued", "sent", "acknowledged", "failed", "cancelled"] }).notNull(),
  body: text("body"),
  providerItemRef: text("provider_item_ref"),
  createdAt: text("created_at").notNull(),
  acknowledgedAt: text("acknowledged_at")
}, (table) => [
  check("ck_conversation_item_kind", sql`${table.kind} in ('user','assistant','tool','system','steer','result')`),
  check("ck_conversation_delivery_state", sql`${table.deliveryState} in ('draft','queued','sent','acknowledged','failed','cancelled')`),
  uniqueIndex("ux_conversation_item_ordinal").on(table.conversationId, table.ordinal),
  index("idx_conversation_item").on(table.conversationId, table.ordinal)
]);

export const conversationQueue = sqliteTable("conversation_queue", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  itemId: text("item_id").notNull().unique().references(() => conversationItems.id),
  mode: text("mode", { enum: ["immediate", "enqueue"] }).notNull(),
  state: text("state", { enum: ["queued", "dispatched", "acknowledged", "failed", "cancelled"] }).notNull(),
  createdAt: text("created_at").notNull(),
  dispatchedAt: text("dispatched_at")
}, (table) => [
  check("ck_conversation_queue_mode", sql`${table.mode} in ('immediate','enqueue')`),
  check("ck_conversation_queue_state", sql`${table.state} in ('queued','dispatched','acknowledged','failed','cancelled')`)
]);

export const conversationAttachments = sqliteTable("conversation_attachment", {
  conversationItemId: text("conversation_item_id").notNull().references(() => conversationItems.id),
  blobId: text("blob_id").notNull().references(() => blobs.id),
  ordinal: integer("ordinal").notNull()
}, (table) => [primaryKey({ columns: [table.conversationItemId, table.ordinal] })]);
