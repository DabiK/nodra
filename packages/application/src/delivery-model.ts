import type { Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";

export interface DeliveryRecord {
  id: Id;
  runId: Id;
  agentDeclaration: string | null;
  observationSummary: string | null;
  resultState: "pending"|"delivered"|"accepted"|"changes_requested"|"rejected";
  acceptedAt: string | null;
  decisionComment: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface DeliveryRepository {
  show(runId: Id): Promise<DeliveryRecord>;
  declare(input: { id: Id; runId: Id; agentDeclaration: string; observationSummary: string; expectedMissionVersion: number; context: CommandContext }): Promise<DeliveryRecord>;
  decide(input: { runId: Id; decision: "accept"|"request-changes"|"reject"; comment: string; expectedMissionVersion: number; context: CommandContext }): Promise<DeliveryRecord>;
}
