import { DomainError, type Id } from "@nodra/domain";
import { executeProviderSessionSync } from "./map-provider-session-sync-error.js";
import type { ProviderSessionDetailProjection } from "./provider-session-projection.js";
import type { ProviderSessionRepository } from "./provider-session-repository.js";
import type { ProviderSessionSyncRegistry } from "./provider-session-sync-registry.js";

export class ShowProviderSession {
  constructor(
    private readonly providers: ProviderSessionSyncRegistry,
    private readonly sessions: ProviderSessionRepository
  ) {}

  async execute(id: Id): Promise<ProviderSessionDetailProjection> {
    const identity = await this.sessions.load(id);
    if (!identity) {
      throw new DomainError(
        `Provider session ${id} was not found locally`,
        "PROVIDER_SESSION_LOCAL_NOT_FOUND"
      );
    }
    const provider = this.providers.resolve(identity.providerId);
    const ref = {
      providerId: identity.providerId,
      externalSessionId: identity.externalSessionRef
    };
    const snapshot = await executeProviderSessionSync(() => provider.readSession(ref));
    const capabilities = await executeProviderSessionSync(() => provider.capabilities());
    if (snapshot.session.ref.providerId !== ref.providerId
      || snapshot.session.ref.externalSessionId !== ref.externalSessionId) {
      throw new DomainError(
        "The provider returned a snapshot for a different session",
        "PROVIDER_SESSION_PROTOCOL_INCOMPATIBLE"
      );
    }
    if (capabilities.providerId !== identity.providerId) {
      throw new DomainError(
        `Provider session capabilities identify ${capabilities.providerId} instead of ${identity.providerId}`,
        "PROVIDER_SESSION_PROTOCOL_INCOMPATIBLE"
      );
    }
    return {
      identity,
      snapshot,
      link: await this.sessions.loadActiveLink(identity.id),
      capabilities
    };
  }
}
