import { sql } from "drizzle-orm";
import { check, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { missions } from "./missions.js";

/**
 * Tags libres des missions (issue #23) : libellé + couleur, attachables à
 * plusieurs missions. La persistance est serveur pour la cohérence multi-écrans
 * (board, fiche mission, filtres).
 */
export const tags = sqliteTable("tag", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  /** Couleur au format #RRGGBB (libre choix de l'utilisateur). */
  color: text("color").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
}, (table) => [
  check("ck_tag_label", sql`length(trim(${table.label})) > 0`),
  check("ck_tag_color", sql`${table.color} GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]'`),
  uniqueIndex("ux_tag_label").on(table.label)
]);

/** Table de liaison mission ↔ tag : une mission peut porter plusieurs tags. */
export const missionTags = sqliteTable("mission_tag", {
  missionId: text("mission_id").notNull().references(() => missions.id),
  tagId: text("tag_id").notNull().references(() => tags.id),
  createdAt: text("created_at").notNull()
}, (table) => [
  primaryKey({ columns: [table.missionId, table.tagId] })
]);
