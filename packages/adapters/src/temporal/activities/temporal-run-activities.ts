import { activityInfo } from "@temporalio/activity";
import type { RunWorkflowActivities, RunWorkflowStartedRequest } from "../contracts.js";
import type { SqliteRunWorkflowActivity } from "../../sqlite/sqlite-run-workflow-activity.js";

export class TemporalRunActivities implements RunWorkflowActivities {
  constructor(private readonly sqlite: SqliteRunWorkflowActivity) {}

  async recordStarted(input: RunWorkflowStartedRequest) {
    const info = activityInfo();
    if (!info.workflowExecution) throw new Error("Temporal workflow execution context is missing");
    return this.sqlite.recordStarted({
      ...input,
      temporalRunId: info.workflowExecution.runId,
      occurredAt: new Date().toISOString()
    });
  }
}
