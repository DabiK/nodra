import { DomainError } from "@nodra/domain";
import type { ProviderPort } from "./provider-port.js";

export class ProviderRegistry {
  private readonly providers: ReadonlyMap<string, ProviderPort>;

  constructor(providers: readonly ProviderPort[]) {
    const entries = new Map<string, ProviderPort>();
    for (const provider of providers) {
      if (entries.has(provider.providerId)) {
        throw new DomainError(
          `Provider ${provider.providerId} is registered more than once`,
          "PROVIDER_REGISTRATION_CONFLICT"
        );
      }
      entries.set(provider.providerId, provider);
    }
    this.providers = entries;
  }

  resolve(providerId: string): ProviderPort {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new DomainError(`Provider ${providerId} is unavailable`, "CAPABILITY_UNAVAILABLE");
    }
    return provider;
  }

  ids(): readonly string[] {
    return [...this.providers.keys()];
  }
}
