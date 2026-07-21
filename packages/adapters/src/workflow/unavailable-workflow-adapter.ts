import type {
  StartMissionInput,
  WorkflowPort,
  WorkflowQuery,
  WorkflowSignal,
  WorkflowUpdate
} from "@nodra/application";
import { WorkflowUnavailableError } from "./workflow-unavailable-error.js";

export class UnavailableWorkflowAdapter implements WorkflowPort {
  async start(_input: StartMissionInput): Promise<{ workflowId: string; runId: string }> {
    throw new WorkflowUnavailableError();
  }

  async signal(_id: string, _signal: WorkflowSignal): Promise<void> {
    throw new WorkflowUnavailableError();
  }

  async update<T>(_id: string, _update: WorkflowUpdate): Promise<T> {
    throw new WorkflowUnavailableError();
  }

  async query<T>(_id: string, _query: WorkflowQuery): Promise<T> {
    throw new WorkflowUnavailableError();
  }
}
