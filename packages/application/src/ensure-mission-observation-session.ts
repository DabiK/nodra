import { asId, DomainError, type Id } from "@nodra/domain";
import { requireProviderSessionCommandId } from "./provider-session-command.js";
import type { ResolvedMissionProviderSession } from "./resolve-mission-provider-session.js";
import type { ResolveMissionProviderSession } from "./resolve-mission-provider-session.js";
import type { ProviderSessionRepository } from "./provider-session-repository.js";

export interface EnsureMissionObservationSessionInput {
  missionId: Id;
  commandId: Id;
  actor: "user" | "manager";
  occurredAt: string;
}

/**
 * Returns the provider session resolved for a mission, creating a read-only
 * observation link on demand from the external thread reference of the latest
 * run when the mission has no provider session attached yet (missions started
 * through the legacy run flow).
 */
export class EnsureMissionObservationSession {
  constructor(
    private readonly sessions: ProviderSessionRepository,
    private readonly resolve: ResolveMissionProviderSession
  ) {}

  async execute(input: EnsureMissionObservationSessionInput): Promise<ResolvedMissionProviderSession> {
    requireProviderSessionCommandId(input.commandId);
    if ((await this.sessions.listActiveLinksForMission(input.missionId)).length > 0) {
      return this.resolve.execute(input.missionId);
    }
    const sessionRef = await this.sessions.latestSessionRefForMission(input.missionId);
    if (!sessionRef) {
      throw new DomainError(
        `Mission ${input.missionId} has no active provider session`,
        "MISSION_PROVIDER_SESSION_NOT_FOUND"
      );
    }
    const identity = await this.sessions.observe({
      id: asId(`provider-session/${input.commandId}`),
      providerId: sessionRef.providerId,
      externalSessionRef: sessionRef.externalSessionRef,
      observedAt: input.occurredAt
    });
    const { link } = await this.sessions.attachToMission({
      providerSessionId: identity.id,
      missionId: input.missionId,
      commandId: input.commandId,
      actor: input.actor,
      occurredAt: input.occurredAt
    });
    return { identity, link };
  }
}
