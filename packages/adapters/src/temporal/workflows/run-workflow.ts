import { condition, proxyActivities } from "@temporalio/workflow";
import type { RunWorkflowActivities, RunWorkflowInput } from "../contracts.js";

const activities = proxyActivities<RunWorkflowActivities>({
  startToCloseTimeout: "10 seconds",
  scheduleToCloseTimeout: "1 minute",
  retry: { initialInterval: "1 second", maximumInterval: "10 seconds", maximumAttempts: 5 }
});

export async function RunWorkflow(input: RunWorkflowInput): Promise<void> {
  await activities.recordStarted({
    missionId: input.missionId,
    commandId: input.commandId,
    runId: input.runId,
    messageId: `run/${input.runId}/activity/record-started/v${input.schemaVersion}`,
    schemaVersion: input.schemaVersion
  });
  await condition(() => false);
}
