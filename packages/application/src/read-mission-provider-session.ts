import type { Id } from "@nodra/domain";
import type { ProviderSessionDetailProjection } from "./provider-session-projection.js";
import { ResolveMissionProviderSession } from "./resolve-mission-provider-session.js";
import { ShowProviderSession } from "./show-provider-session.js";
import type { ProviderSessionRepository } from "./provider-session-repository.js";
import type { ProviderSessionSyncRegistry } from "./provider-session-sync-registry.js";

export class ReadMissionProviderSession {
  private readonly resolveSession: ResolveMissionProviderSession;
  private readonly showSession: ShowProviderSession;

  constructor(providers: ProviderSessionSyncRegistry, sessions: ProviderSessionRepository) {
    this.resolveSession = new ResolveMissionProviderSession(sessions);
    this.showSession = new ShowProviderSession(providers, sessions);
  }

  async execute(missionId: Id): Promise<ProviderSessionDetailProjection> {
    const { identity } = await this.resolveSession.execute(missionId);
    return this.showSession.execute(identity.id);
  }
}
