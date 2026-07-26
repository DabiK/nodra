import type { ProviderCatalogRepository } from "./provider-catalog-repository.js";

export class GetProviderStatus {
  constructor(private readonly catalog: ProviderCatalogRepository) {}

  async execute(providerId: string) {
    const snapshot = await this.catalog.latest(providerId);
    if (snapshot) return snapshot;
    return {
      providerId,
      status: "not_probed",
      reason: "Run the explicit opt-in provider probe before starting a mission"
    } as const;
  }
}
