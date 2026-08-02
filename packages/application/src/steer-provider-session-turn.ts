import { DomainError, type Id } from "@nodra/domain";
import { requireProviderSessionCommandId } from "./provider-session-command.js";
import { executeProviderSessionSync } from "./map-provider-session-sync-error.js";
import type { ProviderSessionControlRegistry } from "./provider-session-control-registry.js";
import type { ProviderSessionTurnCommandResult } from "./provider-session-control-model.js";
import type { ProviderSessionRepository } from "./provider-session-repository.js";
import { ResolveMissionProviderSession } from "./resolve-mission-provider-session.js";

export interface SteerProviderSessionTurnInput {
  missionId: Id;
  commandId: Id;
  externalTurnId: string;
  text: string;
}

export class SteerProviderSessionTurn {
  private readonly resolveSession: ResolveMissionProviderSession;

  constructor(private readonly controls: ProviderSessionControlRegistry, sessions: ProviderSessionRepository) {
    this.resolveSession = new ResolveMissionProviderSession(sessions);
  }

  async execute(input: SteerProviderSessionTurnInput): Promise<ProviderSessionTurnCommandResult> {
    requireProviderSessionCommandId(input.commandId);
    const text = input.text.trim();
    const externalTurnId = input.externalTurnId.trim();
    if (!text) throw new DomainError("A provider steer message is required", "PROVIDER_SESSION_MESSAGE_REQUIRED");
    if (!externalTurnId) throw new DomainError("An active provider turn reference is required", "PROVIDER_SESSION_TURN_REF_REQUIRED");
    const { identity } = await this.resolveSession.execute(input.missionId);
    const provider = this.controls.resolve(identity.providerId);
    const capabilities = await executeProviderSessionSync(() => provider.capabilities());
    if (capabilities.steer.state === "unavailable") throw new DomainError("Steering the provider turn is unavailable", "CAPABILITY_UNAVAILABLE");
    return executeProviderSessionSync(() => provider.steer({
      ref: { providerId: identity.providerId, externalSessionId: identity.externalSessionRef },
      externalTurnId,
      text,
      clientCommandId: input.commandId
    }));
  }
}
