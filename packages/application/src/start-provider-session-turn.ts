import { DomainError, type Id } from "@nodra/domain";
import { requireProviderSessionCommandId } from "./provider-session-command.js";
import { executeProviderSessionSync } from "./map-provider-session-sync-error.js";
import type { ProviderSessionControlRegistry } from "./provider-session-control-registry.js";
import type { ProviderSessionTurnCommandResult } from "./provider-session-control-model.js";
import type { ProviderSessionRepository } from "./provider-session-repository.js";
import { ResolveMissionProviderSession } from "./resolve-mission-provider-session.js";

export interface StartProviderSessionTurnInput {
  missionId: Id;
  commandId: Id;
  text: string;
}

export class StartProviderSessionTurn {
  private readonly resolveSession: ResolveMissionProviderSession;

  constructor(private readonly controls: ProviderSessionControlRegistry, sessions: ProviderSessionRepository) {
    this.resolveSession = new ResolveMissionProviderSession(sessions);
  }

  async execute(input: StartProviderSessionTurnInput): Promise<ProviderSessionTurnCommandResult> {
    requireProviderSessionCommandId(input.commandId);
    const text = input.text.trim();
    if (!text) throw new DomainError("A provider turn message is required", "PROVIDER_SESSION_MESSAGE_REQUIRED");
    const { identity } = await this.resolveSession.execute(input.missionId);
    const provider = this.controls.resolve(identity.providerId);
    const capabilities = await executeProviderSessionSync(() => provider.capabilities());
    if (capabilities.startTurn.state === "unavailable") throw new DomainError("Starting a provider turn is unavailable", "CAPABILITY_UNAVAILABLE");
    return executeProviderSessionSync(() => provider.startTurn({
      ref: { providerId: identity.providerId, externalSessionId: identity.externalSessionRef },
      text,
      clientCommandId: input.commandId
    }));
  }
}
