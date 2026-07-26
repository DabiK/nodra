import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const providerCatalogSnapshots = sqliteTable("provider_catalog_snapshot", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull(),
  catalogVersion: text("catalog_version").notNull(),
  adapterVersion: text("adapter_version").notNull(),
  binaryVersion: text("binary_version"),
  authenticated: integer("authenticated").notNull(),
  authKind: text("auth_kind"),
  capabilitiesJson: text("capabilities_json").notNull(),
  modelsJson: text("models_json").notNull(),
  probedAt: text("probed_at").notNull()
}, (table) => [
  check("ck_provider_catalog_authenticated", sql`${table.authenticated} in (0,1)`),
  check("ck_provider_catalog_capabilities", sql`json_valid(${table.capabilitiesJson})`),
  check("ck_provider_catalog_models", sql`json_valid(${table.modelsJson})`),
  uniqueIndex("ux_provider_catalog_version").on(table.providerId, table.catalogVersion),
  index("idx_provider_catalog_latest").on(table.providerId, table.probedAt)
]);
