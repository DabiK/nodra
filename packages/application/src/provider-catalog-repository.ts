import type { ProviderCatalogSnapshot, ProviderProbeResult } from "./provider-model.js";

export interface ProviderCatalogRepository {
  save(result: ProviderProbeResult): Promise<ProviderCatalogSnapshot>;
  latest(providerId: string): Promise<ProviderCatalogSnapshot | null>;
  markIncompatible(input: {
    providerId: string;
    currentVersion: string | null;
    reason: string;
    occurredAt: string;
  }): Promise<ProviderCatalogSnapshot | null>;
}
