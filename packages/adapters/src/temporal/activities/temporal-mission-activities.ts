import { activityInfo } from "@temporalio/activity";
import type { MissionWorkflowActivities, MissionWorkflowStartedRequest } from "../contracts.js";
import type { SqliteMissionWorkflowActivity } from "../../sqlite/sqlite-mission-workflow-activity.js";

export class TemporalMissionActivities implements MissionWorkflowActivities {
  constructor(private readonly sqlite: SqliteMissionWorkflowActivity) {}

  async recordStarted(input: MissionWorkflowStartedRequest) {
    const info = activityInfo();
    if (!info.workflowExecution) throw new Error("Temporal workflow execution context is missing");
    return this.sqlite.recordStarted({
      ...input,
      temporalRunId: info.workflowExecution.runId,
      occurredAt: new Date().toISOString()
    });
  }
}
