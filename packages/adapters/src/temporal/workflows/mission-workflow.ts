import {
  ChildWorkflowCancellationType,
  CancellationScope,
  condition,
  defineQuery,
  defineSignal,
  isCancellation,
  setHandler,
  startChild
} from "@temporalio/workflow";
import type {
  MissionWorkflowInput,
  MissionWorkflowStatus
} from "../contracts.js";
import { MISSION_CANCEL_SIGNAL, MISSION_STATUS_QUERY } from "../temporal-settings.js";
import { RunWorkflow } from "./run-workflow.js";

export { RunWorkflow } from "./run-workflow.js";

export const missionStatusQuery = defineQuery<MissionWorkflowStatus>(MISSION_STATUS_QUERY);
export const cancelMissionSignal = defineSignal(MISSION_CANCEL_SIGNAL);

export async function MissionWorkflow(input: MissionWorkflowInput): Promise<void> {
  let phase: MissionWorkflowStatus["phase"] = "starting";
  let cancelled = false;
  const childWorkflowId = `run/${input.runId}`;
  setHandler(missionStatusQuery, () => ({
    phase,
    missionId: input.missionId,
    commandId: input.commandId,
    runId: input.runId,
    childWorkflowId,
    schemaVersion: input.schemaVersion
  }));
  setHandler(cancelMissionSignal, () => {
    cancelled = true;
    phase = "cancelled";
  });

  let childStarted = false;
  const childScope = new CancellationScope();
  const childCompletion = childScope.run(async () => {
    const child = await startChild(RunWorkflow, {
      workflowId: childWorkflowId,
      cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
      args: [{
        missionId: input.missionId,
        commandId: input.commandId,
        runId: input.runId,
        snapshotVersion: 1,
        schemaVersion: input.schemaVersion
      }]
    });
    childStarted = true;
    await child.result();
  });
  await condition(() => childStarted || cancelled);
  if (!cancelled) {
    phase = "started";
    await Promise.race([childCompletion, condition(() => cancelled)]);
  }
  if (!cancelled) return;
  childScope.cancel();
  try {
    await childCompletion;
  } catch (error) {
    if (!isCancellation(error)) throw error;
  }
}
