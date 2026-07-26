import type { StartMissionInput, WorkflowPort, WorkflowQuery, WorkflowSignal, WorkflowUpdate } from "@nodra/application";
import { DomainError } from "@nodra/domain";
import type { WorkflowClient } from "@temporalio/client";
import { WorkflowExecutionAlreadyStartedError, WorkflowNotFoundError } from "@temporalio/client";
import { WorkflowIdConflictPolicy, WorkflowIdReusePolicy } from "@temporalio/common";
import {
  MISSION_CANCEL_SIGNAL,
  MISSION_RESUME_SIGNAL,
  MISSION_STEER_SIGNAL,
  MISSION_STATUS_QUERY,
  MISSION_TASK_QUEUE,
  MISSION_WORKFLOW_NAME
} from "../temporal-settings.js";

export class TemporalWorkflowAdapter implements WorkflowPort {
  constructor(private readonly client: WorkflowClient) {}

  async start(input: StartMissionInput): Promise<{ workflowId: string; runId: string }> {
    const workflowId = `mission/${input.missionId}`;
    try {
      const handle = await this.client.start(MISSION_WORKFLOW_NAME, {
        taskQueue: MISSION_TASK_QUEUE,
        workflowId,
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        args: [input]
      });
      return { workflowId, runId: handle.firstExecutionRunId };
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        try {
          const existing = await this.client.getHandle(workflowId).describe();
          return { workflowId, runId: existing.runId };
        } catch {
          throw new DomainError("Temporal runtime is unavailable", "RUNTIME_UNHEALTHY");
        }
      }
      throw new DomainError("Temporal runtime is unavailable", "RUNTIME_UNHEALTHY");
    }
  }

  async signal(id: string, signal: WorkflowSignal): Promise<void> {
    if (
      signal.type === "approval"
      || (signal.type === "steer" && signal.mode !== "immediate")
    ) {
      throw new DomainError("Workflow signal capability is unavailable", "CAPABILITY_UNAVAILABLE");
    }
    try {
      if (signal.type === "cancel") {
        await this.client.getHandle(id).signal(MISSION_CANCEL_SIGNAL);
      } else if (signal.type === "resume") {
        await this.client.getHandle(id).signal(MISSION_RESUME_SIGNAL);
      } else {
        await this.client.getHandle(id).signal(MISSION_STEER_SIGNAL, signal.text);
      }
    } catch (error) {
      throw this.translateLookupError(error);
    }
  }

  async update<T>(_id: string, _update: WorkflowUpdate): Promise<T> {
    throw new DomainError("Workflow updates are not implemented in I3", "CAPABILITY_UNAVAILABLE");
  }

  async query<T>(id: string, query: WorkflowQuery): Promise<T> {
    if (query.type !== "status") throw new DomainError("Workflow query is not implemented", "CAPABILITY_UNAVAILABLE");
    try {
      return await this.client.getHandle(id).query(MISSION_STATUS_QUERY) as T;
    } catch (error) {
      throw this.translateLookupError(error);
    }
  }

  private translateLookupError(error: unknown): DomainError {
    if (error instanceof WorkflowNotFoundError) return new DomainError("Workflow was not found", "WORKFLOW_NOT_FOUND");
    return new DomainError("Temporal runtime is unavailable", "RUNTIME_UNHEALTHY");
  }
}
