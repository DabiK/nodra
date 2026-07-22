import { DomainError, type Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type { DeliveryRepository } from "./delivery-model.js";

export class ManageDelivery {
  constructor(private readonly repository: DeliveryRepository) {}
  show(runId: Id) { return this.repository.show(runId); }
  declare(input: { id: Id; runId: Id; agentDeclaration: string; observationSummary: string; expectedMissionVersion: number; context: CommandContext }) {
    if (!input.agentDeclaration.trim()) throw new DomainError("Agent declaration is required", "REQUEST_INVALID");
    if (!Number.isInteger(input.expectedMissionVersion) || input.expectedMissionVersion < 0) throw new DomainError("expectedMissionVersion is invalid", "REQUEST_INVALID");
    return this.repository.declare(input);
  }
  decide(input: { runId: Id; decision: "accept"|"request-changes"|"reject"; comment: string; expectedMissionVersion: number; context: CommandContext }) {
    if (!input.comment.trim()) throw new DomainError("Delivery decision comment is required", "REQUEST_INVALID");
    if (!Number.isInteger(input.expectedMissionVersion) || input.expectedMissionVersion < 0) throw new DomainError("expectedMissionVersion is invalid", "REQUEST_INVALID");
    return this.repository.decide(input);
  }
}
