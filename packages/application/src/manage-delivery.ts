import { DomainError, type Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type { DeliveryRepository } from "./delivery-model.js";
import type { GateFreshnessPort } from "./gate-model.js";

export class ManageDelivery {
  constructor(private readonly repository: DeliveryRepository, private readonly freshness: GateFreshnessPort) {}
  show(runId: Id) { return this.repository.show(runId); }
  declare(input: { id: Id; runId: Id; agentDeclaration: string; observationSummary: string; expectedMissionVersion: number; context: CommandContext }) {
    if (!input.agentDeclaration.trim()) throw new DomainError("Agent declaration is required", "REQUEST_INVALID");
    if (!Number.isInteger(input.expectedMissionVersion) || input.expectedMissionVersion < 0) throw new DomainError("expectedMissionVersion is invalid", "REQUEST_INVALID");
    return this.repository.declare(input);
  }
  async decide(input: { runId: Id; decision: "accept"|"request-changes"|"reject"; comment: string; expectedMissionVersion: number; context: CommandContext }) {
    if (!input.comment.trim()) throw new DomainError("Delivery decision comment is required", "REQUEST_INVALID");
    if (!Number.isInteger(input.expectedMissionVersion) || input.expectedMissionVersion < 0) throw new DomainError("expectedMissionVersion is invalid", "REQUEST_INVALID");
    if (input.decision === "accept") {
      const refreshed = await this.freshness.refreshStaleness({ runId: input.runId, context: input.context });
      if (refreshed.stale.length > 0) throw new DomainError("Gate evidence became stale before acceptance", "EVIDENCE_STALE");
    }
    return this.repository.decide(input);
  }
}
