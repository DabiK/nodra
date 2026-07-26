import { DomainError } from "@nodra/domain";
import type { ProviderCatalogRepository } from "./provider-catalog-repository.js";
import type { ProviderRegistry } from "./provider-registry.js";

export class ProbeProvider {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly catalog: ProviderCatalogRepository
  ) {}

  async execute(input: { providerId: string; optIn: boolean }) {
    if (!input.optIn) {
      throw new DomainError(
        "Provider probe is opt-in; pass the explicit process-launch confirmation",
        "PROVIDER_PROBE_OPT_IN_REQUIRED"
      );
    }
    return this.catalog.save(await this.providers.resolve(input.providerId).probe());
  }
}
