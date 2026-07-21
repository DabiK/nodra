import { condition, defineQuery, defineSignal, proxyActivities, setHandler } from "@temporalio/workflow";
import type {
  MissionWorkflowActivities,
  MissionWorkflowInput,
  MissionWorkflowStatus
} from "../contracts.js";
import { MISSION_CANCEL_SIGNAL, MISSION_STATUS_QUERY } from "../temporal-settings.js";

export const missionStatusQuery = defineQuery<MissionWorkflowStatus>(MISSION_STATUS_QUERY);
export const cancelMissionSignal = defineSignal(MISSION_CANCEL_SIGNAL);

const activities = proxyActivities<MissionWorkflowActivities>({
  startToCloseTimeout: "10 seconds",
  scheduleToCloseTimeout: "1 minute",
  retry: { initialInterval: "1 second", maximumInterval: "10 seconds", maximumAttempts: 5 }
});

export async function MissionWorkflow(input: MissionWorkflowInput): Promise<void> {
  let phase: MissionWorkflowStatus["phase"] = "starting";
  let cancelled = false;
  setHandler(missionStatusQuery, () => ({
    phase,
    missionId: input.missionId,
    commandId: input.commandId,
    schemaVersion: input.schemaVersion
  }));
  setHandler(cancelMissionSignal, () => {
    cancelled = true;
    phase = "cancelled";
  });

  await activities.recordStarted({
    missionId: input.missionId,
    commandId: input.commandId,
    messageId: `mission/${input.missionId}/activity/record-started/v${input.schemaVersion}`,
    schemaVersion: input.schemaVersion
  });
  if (!cancelled) phase = "started";
  await condition(() => cancelled);
}
