import type {
  ProviderCatalogRepository,
  ProviderCatalogSnapshot,
  ProviderProbeResult
} from "@nodra/application";
import { deriveProviderHealth } from "@nodra/application";
import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { providerCatalogSnapshots } from "./schema/provider-catalog.js";

export class SqliteProviderCatalogRepository implements ProviderCatalogRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async save(result: ProviderProbeResult): Promise<ProviderCatalogSnapshot> {
    const catalogVersion = createHash("sha256")
      .update(JSON.stringify({
        adapterVersion: result.adapterVersion,
        binaryVersion: result.binaryVersion,
        capabilities: result.capabilities,
        models: result.models
      }))
      .digest("hex");
    this.database.orm.insert(providerCatalogSnapshots).values({
      id: `${result.providerId}/${catalogVersion}`,
      providerId: result.providerId,
      catalogVersion,
      adapterVersion: result.adapterVersion,
      binaryVersion: result.binaryVersion,
      authenticated: result.authenticated ? 1 : 0,
      authKind: result.authKind,
      capabilitiesJson: JSON.stringify(result.capabilities),
      modelsJson: JSON.stringify(result.models),
      probedAt: result.probedAt
    }).onConflictDoNothing().run();
    return { ...result, catalogVersion };
  }

  async latest(providerId: string): Promise<ProviderCatalogSnapshot | null> {
    const row = this.database.orm.select().from(providerCatalogSnapshots)
      .where(eq(providerCatalogSnapshots.providerId, providerId))
      .orderBy(desc(providerCatalogSnapshots.probedAt))
      .limit(1)
      .get();
    if (!row) return null;
    return {
      providerId: row.providerId,
      catalogVersion: row.catalogVersion,
      adapterVersion: row.adapterVersion,
      binaryVersion: row.binaryVersion,
      authenticated: row.authenticated === 1,
      authKind: row.authKind,
      capabilities: JSON.parse(row.capabilitiesJson),
      models: JSON.parse(row.modelsJson),
      probedAt: row.probedAt,
      health: deriveProviderHealth(JSON.parse(row.capabilitiesJson))
    };
  }

  async markIncompatible(input: {
    providerId: string;
    currentVersion: string | null;
    reason: string;
    occurredAt: string;
  }): Promise<ProviderCatalogSnapshot | null> {
    const current = await this.latest(input.providerId);
    if (!current) return null;
    const unavailable = { available: false, reason: "protocol_incompatible" };
    return this.save({
      providerId: current.providerId,
      adapterVersion: current.adapterVersion,
      binaryVersion: input.currentVersion ?? current.binaryVersion,
      authenticated: current.authenticated,
      authKind: current.authKind,
      health: {
        status: "degraded",
        reason: "protocol_incompatible",
        actionRequired: "update_required"
      },
      models: current.models,
      capabilities: {
        ...current.capabilities,
        version: `${current.adapterVersion}:${input.currentVersion ?? current.binaryVersion ?? "unknown"}`,
        contract: {
          ...unavailable,
          status: "incompatible",
          expectedVersion: current.capabilities.contract.expectedVersion,
          currentVersion: input.currentVersion ?? current.binaryVersion,
          action: `${input.reason}; follow CONTRACT_UPGRADE.md before enabling new runs`
        },
        start: unavailable,
        events: unavailable,
        cancel: unavailable,
        resume: unavailable,
        steer: { ...unavailable, mode: "none" },
        permissionInterception: unavailable
      },
      probedAt: input.occurredAt
    });
  }
}
