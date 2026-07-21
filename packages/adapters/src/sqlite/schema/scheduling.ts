import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { approvals } from "./approvals.js";
import { runs } from "./runs.js";

export const budgetWindows = sqliteTable("budget_window", {
  id: text("id").primaryKey(),
  scope: text("scope", { enum: ["global", "mission"] }).notNull(),
  scopeId: text("scope_id"),
  period: text("period", { enum: ["week", "mission_lifetime"] }).notNull(),
  enforcement: text("enforcement", { enum: ["confirmable", "absolute"] }).notNull().default("confirmable"),
  softLimitUnits: integer("soft_limit_units").notNull(),
  hardLimitUnits: integer("hard_limit_units"),
  activeFrom: text("active_from").notNull(),
  activeUntil: text("active_until")
}, (table) => [
  check("ck_budget_scope", sql`${table.scope} in ('global','mission')`),
  check("ck_budget_period", sql`${table.period} in ('week','mission_lifetime')`),
  check("ck_budget_enforcement", sql`${table.enforcement} in ('confirmable','absolute')`),
  check("ck_budget_soft_limit", sql`${table.softLimitUnits} >= 0`),
  check("ck_budget_hard_limit", sql`${table.hardLimitUnits} is null or ${table.hardLimitUnits} >= ${table.softLimitUnits}`),
  check("ck_budget_scope_period", sql`(${table.scope} = 'global' and ${table.scopeId} is null and ${table.period} = 'week') or (${table.scope} = 'mission' and ${table.scopeId} is not null and ${table.period} = 'mission_lifetime')`),
  check("ck_budget_enforcement_limit", sql`(${table.enforcement} = 'confirmable' and ${table.hardLimitUnits} is null) or ${table.enforcement} = 'absolute'`),
  uniqueIndex("ux_budget_window_scope").on(table.scope, sql`coalesce(${table.scopeId}, '')`, table.period, table.activeFrom)
]);

export const budgetOverrides = sqliteTable("budget_override", {
  id: text("id").primaryKey(),
  budgetWindowId: text("budget_window_id").notNull().references(() => budgetWindows.id),
  approvalId: text("approval_id").notNull().references(() => approvals.id),
  unitsDelta: integer("units_delta").notNull(),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull()
});

export const concurrencyPolicies = sqliteTable("concurrency_policy", {
  id: text("id").primaryKey(),
  scope: text("scope", { enum: ["global", "project", "provider"] }).notNull(),
  scopeId: text("scope_id"),
  maxActive: integer("max_active").notNull()
}, (table) => [
  check("ck_concurrency_scope", sql`${table.scope} in ('global','project','provider')`),
  check("ck_concurrency_max_active", sql`${table.maxActive} > 0`),
  check("ck_concurrency_subject", sql`(${table.scope} = 'global' and ${table.scopeId} is null) or (${table.scope} in ('project','provider') and ${table.scopeId} is not null)`),
  uniqueIndex("ux_concurrency_policy_scope").on(table.scope, sql`coalesce(${table.scopeId}, '')`)
]);

export const concurrencyLeases = sqliteTable("concurrency_lease", {
  id: text("id").primaryKey(),
  policyId: text("policy_id").notNull().references(() => concurrencyPolicies.id),
  runId: text("run_id").notNull().unique().references(() => runs.id),
  acquiredAt: text("acquired_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  releasedAt: text("released_at")
});

export const budgetLedger = sqliteTable("budget_ledger", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  budgetWindowId: text("budget_window_id").references(() => budgetWindows.id),
  usageKind: text("usage_kind", { enum: ["reported", "estimated", "unavailable"] }).notNull(),
  units: integer("units").notNull(),
  costMicros: integer("cost_micros"),
  providerUsageJson: text("provider_usage_json").notNull(),
  createdAt: text("created_at").notNull()
}, (table) => [
  check("ck_budget_ledger_usage_kind", sql`${table.usageKind} in ('reported','estimated','unavailable')`),
  check("ck_budget_ledger_units", sql`${table.units} >= 0`),
  check("ck_budget_ledger_cost", sql`${table.costMicros} is null or ${table.costMicros} >= 0`),
  check("ck_budget_ledger_json", sql`json_valid(${table.providerUsageJson})`),
  index("idx_budget_ledger_run").on(table.runId, table.createdAt)
]);
