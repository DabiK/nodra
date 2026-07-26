import type { ProviderCatalogRepository } from "./provider-catalog-repository.js";
import type { ProviderRegistry } from "./provider-registry.js";

export class GetProviderStatus {
  constructor(
    private readonly catalog: ProviderCatalogRepository,
    private readonly providers?: ProviderRegistry
  ) {}

  async execute(providerId: string) {
    this.providers?.resolve(providerId);
    const snapshot = await this.catalog.latest(providerId);
    if (snapshot) return snapshot;
    return {
      providerId,
      status: "not_probed",
      reason: "Run the explicit opt-in provider probe before starting a mission"
    } as const;
  }
}
