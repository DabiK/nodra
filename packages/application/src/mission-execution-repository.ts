import type { Id, Mission } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";

export interface PersistMissionStartInput {
  mission: Mission;
  expectedVersion: number;
  runId: Id;
  conversationId: Id;
  workflowId: string;
  auditId: Id;
  outboxId: Id;
  context: CommandContext;
}

export interface MissionExecutionRepository {
  validateStart(missionId: Id): Promise<void>;
  persistStart(input: PersistMissionStartInput): Promise<void>;
}
