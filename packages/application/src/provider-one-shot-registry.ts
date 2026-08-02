import { DomainError } from "@nodra/domain";
import type { ProviderOneShotPort } from "./provider-one-shot-model.js";

export class ProviderOneShotRegistry {
  private readonly providers = new Map<string, ProviderOneShotPort>();

  constructor(ports: readonly ProviderOneShotPort[]) {
    for (const port of ports) {
      if (this.providers.has(port.providerId)) {
        throw new DomainError(`Duplicate provider one-shot port ${port.providerId}`, "PROVIDER_ONE_SHOT_PROVIDER_DUPLICATE");
      }
      this.providers.set(port.providerId, port);
    }
  }

  ids(): string[] {
    return [...this.providers.keys()];
  }

  resolve(providerId: string): ProviderOneShotPort {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new DomainError(`No provider one-shot port is registered for ${providerId}`, "PROVIDER_ONE_SHOT_PROVIDER_NOT_FOUND");
    }
    return provider;
  }
}
