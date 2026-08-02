import { asId, DomainError, type Id } from "@nodra/domain";
import type { MissionRelayRecord, MissionRepository } from "./mission-repository.js";
import type { ProviderSessionItem, ProviderSessionRef } from "./provider-session-sync-model.js";
import type { ProviderSessionSyncRegistry } from "./provider-session-sync-registry.js";

export interface AutoValidateMissionAfterTurnInput {
  missionId: Id;
  ref: ProviderSessionRef;
  externalTurnId: string | null;
  occurredAt: string;
}

/**
 * Expected, benign outcomes of an automatic validation transition. These are
 * swallowed so a completed provider turn is never reported as failed:
 * - TRANSITION_FORBIDDEN / VALIDATION_RESULT_REQUIRED: the mission guard
 *   rejected the transition (e.g. concurrent state change, missing result).
 * - MISSION_VERSION_CONFLICT: the mission moved concurrently since load.
 * - COMMAND_ID_CONFLICT: the same turn was already auto-validated (retry).
 * Any other error (e.g. infrastructure failures) must surface.
 */
const swallowedCodes = new Set([
  "TRANSITION_FORBIDDEN",
  "VALIDATION_RESULT_REQUIRED",
  "MISSION_VERSION_CONFLICT",
  "COMMAND_ID_CONFLICT"
]);

const lastAssistantMessage = (items: readonly ProviderSessionItem[], externalTurnId: string | null): string | null => {
  const candidates = items
    .filter((item) => item.role === "assistant" && item.kind === "message" && !!item.text)
    .slice()
    .sort((a, b) => a.order - b.order);
  if (candidates.length === 0) return null;
  if (externalTurnId) {
    const forTurn = candidates.filter((item) => item.externalTurnId === externalTurnId);
    if (forTurn.length > 0) return forTurn[forTurn.length - 1]!.text!.trim();
  }
  return candidates[candidates.length - 1]!.text!.trim();
};

export class AutoValidateMissionAfterTurn {
  constructor(
    private readonly missions: MissionRepository,
    private readonly providers: ProviderSessionSyncRegistry
  ) {}

  async execute(input: AutoValidateMissionAfterTurnInput): Promise<void> {
    // Reading the post-turn snapshot is best-effort: if the provider session
    // is gone or unreachable after a completed turn, auto-validation silently
    // skips instead of surfacing a failure on an already-completed turn.
    let declaredResult: string | null = null;
    try {
      const provider = this.providers.resolve(input.ref.providerId);
      const snapshot = await provider.readSession(input.ref);
      declaredResult = lastAssistantMessage(snapshot.items, input.externalTurnId);
    } catch {
      return;
    }
    if (!declaredResult) return;

    try {
      await this.transition(input, declaredResult);
    } catch (error) {
      if (error instanceof DomainError && swallowedCodes.has(error.code)) return;
      throw error;
    }
  }

  private async transition(input: AutoValidateMissionAfterTurnInput, declaredResult: string): Promise<void> {
    const mission = await this.missions.load(input.missionId);
    if (!mission) return;
    const before = mission.snapshot();
    if (before.executionKind !== "agent" || before.state !== "ACTIVE") return;
    mission.recordAgentSuccess(input.occurredAt, declaredResult);
    const after = mission.snapshot();
    // The audit commandId is derived from the turn id so an idempotent retry
    // of the same turn reuses it and is caught as COMMAND_ID_CONFLICT.
    const commandId = asId(`turn-${input.externalTurnId ?? "completed"}/${after.id}/auto-validated`);
    const payload = {
      schemaVersion: 1,
      action: "auto-validate",
      fromState: before.state,
      toState: after.state,
      missionVersion: after.version,
      declaredResult
    };
    const relay: MissionRelayRecord = {
      id: asId(`relay/mission/${after.id}`),
      queue: "decision_required",
      reasonCode: "agent_result_requires_validation",
      createdAt: input.occurredAt
    };
    await this.missions.save({
      mission,
      expectedVersion: before.version,
      audit: {
        id: asId(`audit/${commandId}`),
        commandId,
        eventType: "MISSION_SUBMITTED_FOR_VALIDATION",
        actor: "manager",
        payload,
        occurredAt: input.occurredAt
      },
      outbox: {
        id: asId(`outbox/${commandId}`),
        kind: "mission.changed",
        dedupeKey: `mission/${after.id}/version/${after.version}/auto-validate`,
        payload: { ...payload, missionId: after.id },
        createdAt: input.occurredAt
      },
      relay
    });
  }
}
