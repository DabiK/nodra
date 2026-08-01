import type { Id } from "@nodra/domain";
import { executeProviderSessionSync } from "./map-provider-session-sync-error.js";
import type { ProviderSessionControlCapabilities } from "./provider-session-control-model.js";
import type { ProviderSessionControlRegistry } from "./provider-session-control-registry.js";
import type { ProviderSessionIdentity, ProviderSessionLink } from "./provider-session-model.js";
import type { ProviderSessionRepository } from "./provider-session-repository.js";
import { ResolveMissionProviderSession } from "./resolve-mission-provider-session.js";

export class GetMissionProviderSessionControlCapabilities {
  private readonly resolveSession: ResolveMissionProviderSession;

  constructor(private readonly controls: ProviderSessionControlRegistry, sessions: ProviderSessionRepository) {
    this.resolveSession = new ResolveMissionProviderSession(sessions);
  }

  async execute(missionId: Id): Promise<{
    identity: ProviderSessionIdentity;
    link: ProviderSessionLink;
    capabilities: ProviderSessionControlCapabilities;
  }> {
    const { identity, link } = await this.resolveSession.execute(missionId);
    const provider = this.controls.resolve(identity.providerId);
    const capabilities = await executeProviderSessionSync(() => provider.capabilities());
    return { identity, link, capabilities };
  }
}
