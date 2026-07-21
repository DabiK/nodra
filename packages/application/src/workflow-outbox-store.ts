import type { Id } from "@nodra/domain";
import type { StartMissionInput } from "./workflow-port.js";

export interface PendingWorkflowStart {
  id: Id;
  dedupeKey: string;
  input: StartMissionInput;
}

export interface WorkflowOutboxStore {
  listPendingStarts(limit: number): Promise<PendingWorkflowStart[]>;
  markPublished(id: Id, publishedAt: string): Promise<void>;
}
