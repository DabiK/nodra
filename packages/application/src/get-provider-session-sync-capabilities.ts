import { DomainError } from "@nodra/domain";
import { executeProviderSessionSync } from "./map-provider-session-sync-error.js";
import type { ProviderSessionSyncCapabilities } from "./provider-session-sync-model.js";
import type { ProviderSessionSyncRegistry } from "./provider-session-sync-registry.js";

export class GetProviderSessionSyncCapabilities {
  constructor(private readonly providers: ProviderSessionSyncRegistry) {}

  async execute(providerId: string): Promise<ProviderSessionSyncCapabilities> {
    const provider = this.providers.resolve(providerId);
    const capabilities = await executeProviderSessionSync(() => provider.capabilities());
    if (capabilities.providerId !== providerId) {
      throw new DomainError(
        `Provider session capabilities identify ${capabilities.providerId} instead of ${providerId}`,
        "PROVIDER_SESSION_PROTOCOL_INCOMPATIBLE"
      );
    }
    return capabilities;
  }
}
