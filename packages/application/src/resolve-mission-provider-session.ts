import { DomainError, type Id } from "@nodra/domain";
import type { ProviderSessionIdentity, ProviderSessionLink } from "./provider-session-model.js";
import type { ProviderSessionRepository } from "./provider-session-repository.js";

export interface ResolvedMissionProviderSession {
  identity: ProviderSessionIdentity;
  link: ProviderSessionLink;
}

export class ResolveMissionProviderSession {
  constructor(private readonly sessions: ProviderSessionRepository) {}

  async execute(missionId: Id): Promise<ResolvedMissionProviderSession> {
    const links = await this.sessions.listActiveLinksForMission(missionId);
    if (links.length === 0) {
      throw new DomainError(`Mission ${missionId} has no active provider session`, "MISSION_PROVIDER_SESSION_NOT_FOUND");
    }
    const controlled = links.filter((link) => link.mode === "control");
    const candidates = controlled.length > 0 ? controlled : links;
    if (candidates.length !== 1) {
      throw new DomainError(`Mission ${missionId} has multiple active provider sessions`, "MISSION_PROVIDER_SESSION_AMBIGUOUS");
    }
    const link = candidates[0]!;
    const identity = await this.sessions.load(link.providerSessionId);
    if (!identity) {
      throw new DomainError(`Provider session ${link.providerSessionId} was not found`, "PROVIDER_SESSION_NOT_FOUND");
    }
    return { identity, link };
  }
}
