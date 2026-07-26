import { DomainError } from "@nodra/domain";
import type { ProviderCatalogRepository } from "./provider-catalog-repository.js";
import type { ProviderPort } from "./provider-port.js";

export class ProbeProvider {
  constructor(
    private readonly provider: ProviderPort,
    private readonly catalog: ProviderCatalogRepository
  ) {}

  async execute(input: { providerId: string; optIn: boolean }) {
    if (!input.optIn) {
      throw new DomainError(
        "Provider probe is opt-in; pass the explicit process-launch confirmation",
        "PROVIDER_PROBE_OPT_IN_REQUIRED"
      );
    }
    if (input.providerId !== this.provider.providerId) {
      throw new DomainError(`Provider ${input.providerId} is unavailable`, "CAPABILITY_UNAVAILABLE");
    }
    return this.catalog.save(await this.provider.probe());
  }
}
