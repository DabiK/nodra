import { DomainError } from "@nodra/domain";
import type { ProviderSessionSyncPort } from "./provider-session-sync-port.js";

export class ProviderSessionSyncRegistry {
  private readonly providers: ReadonlyMap<string, ProviderSessionSyncPort>;

  constructor(providers: readonly ProviderSessionSyncPort[]) {
    const entries = new Map<string, ProviderSessionSyncPort>();
    for (const provider of providers) {
      if (entries.has(provider.providerId)) {
        throw new DomainError(
          `Provider session sync ${provider.providerId} is registered more than once`,
          "PROVIDER_SESSION_SYNC_REGISTRATION_CONFLICT"
        );
      }
      entries.set(provider.providerId, provider);
    }
    this.providers = entries;
  }

  resolve(providerId: string): ProviderSessionSyncPort {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new DomainError(
        `Provider session sync ${providerId} is unavailable`,
        "PROVIDER_SESSION_SYNC_PROVIDER_NOT_FOUND"
      );
    }
    return provider;
  }
}
