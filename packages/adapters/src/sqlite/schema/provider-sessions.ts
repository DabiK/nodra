import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { missions } from "./missions.js";

export const providerSessions = sqliteTable("provider_session", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull(),
  externalSessionRef: text("external_session_ref").notNull(),
  ownership: text("ownership", { enum: ["external_observed"] }).notNull(),
  firstObservedAt: text("first_observed_at").notNull(),
  lastObservedAt: text("last_observed_at").notNull()
}, (table) => [
  check("ck_provider_session_provider", sql`length(trim(${table.providerId})) > 0`),
  check("ck_provider_session_external_ref", sql`length(${table.externalSessionRef}) > 0`),
  check("ck_provider_session_ownership", sql`${table.ownership} = 'external_observed'`),
  uniqueIndex("ux_provider_session_provider_ref").on(table.providerId, table.externalSessionRef)
]);

export const providerSessionLinks = sqliteTable("provider_session_link", {
  id: text("id").primaryKey(),
  providerSessionId: text("provider_session_id").notNull().references(() => providerSessions.id),
  missionId: text("mission_id").notNull().references(() => missions.id),
  mode: text("mode", { enum: ["read_only", "control"] }).notNull(),
  attachedAt: text("attached_at").notNull(),
  detachedAt: text("detached_at")
}, (table) => [
  check("ck_provider_session_link_mode", sql`${table.mode} in ('read_only', 'control')`),
  uniqueIndex("ux_provider_session_link_active")
    .on(table.providerSessionId)
    .where(sql`${table.detachedAt} is null`),
  index("idx_provider_session_link_mission").on(table.missionId)
]);
