import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { runs } from "./runs.js";

export const providerEvents = sqliteTable("provider_event", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  sequence: integer("sequence").notNull(),
  type: text("type").notNull(),
  payloadJson: text("payload_json").notNull(),
  sourceAt: text("source_at"),
  receivedAt: text("received_at").notNull()
}, (table) => [
  check("ck_provider_event_sequence", sql`${table.sequence} >= 0`),
  check("ck_provider_event_payload", sql`json_valid(${table.payloadJson})`),
  uniqueIndex("ux_provider_event_sequence").on(table.runId, table.sequence)
]);
