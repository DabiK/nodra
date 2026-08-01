import { DomainError } from "@nodra/domain";
import type { ProviderSessionControlPort } from "./provider-session-control-port.js";

export class ProviderSessionControlRegistry {
  private readonly providers = new Map<string, ProviderSessionControlPort>();

  constructor(ports: readonly ProviderSessionControlPort[]) {
    for (const port of ports) {
      if (this.providers.has(port.providerId)) {
        throw new DomainError(`Duplicate provider session control port ${port.providerId}`, "PROVIDER_SESSION_CONTROL_PROVIDER_DUPLICATE");
      }
      this.providers.set(port.providerId, port);
    }
  }

  resolve(providerId: string): ProviderSessionControlPort {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new DomainError(`No provider session control port is registered for ${providerId}`, "PROVIDER_SESSION_CONTROL_PROVIDER_NOT_FOUND");
    }
    return provider;
  }
}
