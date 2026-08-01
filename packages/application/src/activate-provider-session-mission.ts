import { DomainError } from "@nodra/domain";
import { requireProviderSessionCommandId } from "./provider-session-command.js";
import { executeProviderSessionSync } from "./map-provider-session-sync-error.js";
import type { ProviderSessionControlRegistry } from "./provider-session-control-registry.js";
import type { ProviderSessionControlRepository } from "./provider-session-control-repository.js";
import type { ActivateProviderSessionMissionInput, ActivatedProviderSessionMissionResult } from "./provider-session-model.js";
import type { ProviderSessionRepository } from "./provider-session-repository.js";
import { ResolveMissionProviderSession } from "./resolve-mission-provider-session.js";

export class ActivateProviderSessionMission {
  private readonly resolveSession: ResolveMissionProviderSession;

  constructor(
    private readonly controls: ProviderSessionControlRegistry,
    private readonly sessions: ProviderSessionRepository & ProviderSessionControlRepository
  ) {
    this.resolveSession = new ResolveMissionProviderSession(sessions);
  }

  async execute(input: ActivateProviderSessionMissionInput): Promise<ActivatedProviderSessionMissionResult> {
    requireProviderSessionCommandId(input.commandId);
    const { identity } = await this.resolveSession.execute(input.missionId);
    const capabilities = await executeProviderSessionSync(() => this.controls.resolve(identity.providerId).capabilities());
    if (capabilities.providerId !== identity.providerId) {
      throw new DomainError("Provider control capabilities identify a different provider", "PROVIDER_SESSION_PROTOCOL_INCOMPATIBLE");
    }
    if (capabilities.read.state === "unavailable" || capabilities.startTurn.state === "unavailable") {
      throw new DomainError("Provider session control is unavailable", "CAPABILITY_UNAVAILABLE");
    }
    return this.sessions.activateMissionControl(input);
  }
}
