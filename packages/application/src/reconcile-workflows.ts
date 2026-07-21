import { DomainError, type Id } from "@nodra/domain";
import type { WorkflowPort } from "./workflow-port.js";

export interface ActiveWorkflowRecord {
  missionId: Id;
  runId: Id;
  workflowId: string;
}

export interface WorkflowReconciliationStore {
  listActiveWorkflows(): Promise<ActiveWorkflowRecord[]>;
}

export interface WorkflowReconciliationItem extends ActiveWorkflowRecord {
  status: "reachable" | "missing";
}

export class ReconcileWorkflows {
  constructor(
    private readonly store: WorkflowReconciliationStore,
    private readonly workflows: WorkflowPort
  ) {}

  async execute(): Promise<{ items: WorkflowReconciliationItem[] }> {
    const active = await this.store.listActiveWorkflows();
    const items: WorkflowReconciliationItem[] = [];
    for (const record of active) {
      try {
        await this.workflows.query(record.workflowId, { type: "status" });
        items.push({ ...record, status: "reachable" });
      } catch (error) {
        if (error instanceof DomainError && error.code === "WORKFLOW_NOT_FOUND") {
          items.push({ ...record, status: "missing" });
        } else {
          throw error;
        }
      }
    }
    return { items };
  }
}
