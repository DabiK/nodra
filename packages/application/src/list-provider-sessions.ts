import type { ProviderSessionIdGenerator } from "./provider-session-id-generator.js";
import { executeProviderSessionSync } from "./map-provider-session-sync-error.js";
import { DomainError } from "@nodra/domain";
import type { ProviderSessionListProjection } from "./provider-session-projection.js";
import type { ProviderSessionRepository } from "./provider-session-repository.js";
import type { ProviderSessionListQuery } from "./provider-session-sync-model.js";
import type { ProviderSessionSyncRegistry } from "./provider-session-sync-registry.js";

export class ListProviderSessions {
  constructor(
    private readonly providers: ProviderSessionSyncRegistry,
    private readonly sessions: ProviderSessionRepository,
    private readonly ids: ProviderSessionIdGenerator
  ) {}

  async execute(query: ProviderSessionListQuery): Promise<ProviderSessionListProjection> {
    const provider = this.providers.resolve(query.providerId);
    const page = await executeProviderSessionSync(() => provider.listSessions(query));
    const projected: ProviderSessionListProjection["sessions"] = [];
    for (const summary of page.sessions) {
      if (summary.ref.providerId !== provider.providerId) {
        throw new DomainError(
          `Provider ${provider.providerId} returned a session attributed to ${summary.ref.providerId}`,
          "PROVIDER_SESSION_PROTOCOL_INCOMPATIBLE"
        );
      }
      const identity = await this.sessions.observe({
        id: this.ids.next(),
        providerId: summary.ref.providerId,
        externalSessionRef: summary.ref.externalSessionId,
        observedAt: summary.receivedAt
      });
      projected.push({
        id: identity.id,
        summary,
        link: await this.sessions.loadActiveLink(identity.id)
      });
    }
    return { sessions: projected, nextCursor: page.nextCursor };
  }
}
