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
import {
  MISSION_CANCEL_SIGNAL,
  MISSION_RESUME_SIGNAL,
  MISSION_STATUS_QUERY,
  MISSION_STEER_SIGNAL
} from "../temporal-settings.js";
import { RunWorkflow } from "./run-workflow.js";

export { RunWorkflow } from "./run-workflow.js";

export const missionStatusQuery = defineQuery<MissionWorkflowStatus>(MISSION_STATUS_QUERY);
export const cancelMissionSignal = defineSignal(MISSION_CANCEL_SIGNAL);
export const steerMissionSignal = defineSignal<[string]>(MISSION_STEER_SIGNAL);
export const resumeMissionSignal = defineSignal(MISSION_RESUME_SIGNAL);

export async function MissionWorkflow(input: MissionWorkflowInput): Promise<void> {
  let phase: MissionWorkflowStatus["phase"] = "starting";
  let cancelled = false;
  const steerQueue: string[] = [];
  let resumeRequested = false;
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
  setHandler(steerMissionSignal, (text) => {
    steerQueue.push(text);
  });
  setHandler(resumeMissionSignal, () => {
    resumeRequested = true;
  });

  let childStarted = false;
  const childScope = new CancellationScope();
  const childCompletion = childScope.run(async () => {
    const child = await startChild(RunWorkflow, {
      workflowId: childWorkflowId,
      cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
      args: [{
        missionId: input.missionId,
        ...(input.managerId ? { managerId: input.managerId } : {}),
        ...(input.subjectKind ? { subjectKind: input.subjectKind } : {}),
        commandId: input.commandId,
        runId: input.runId,
        snapshotVersion: 1,
        schemaVersion: input.schemaVersion,
        ...(input.executeProvider === undefined ? {} : { executeProvider: input.executeProvider })
      }]
    });
    childStarted = true;
    let childDone = false;
    const result = child.result().finally(() => { childDone = true; });
    while (!childDone && !cancelled) {
      await condition(() => childDone || cancelled || steerQueue.length > 0 || resumeRequested);
      while (steerQueue.length > 0) {
        const text = steerQueue.shift();
        if (text) await child.signal(MISSION_STEER_SIGNAL, text);
      }
      if (resumeRequested) {
        resumeRequested = false;
        await child.signal(MISSION_RESUME_SIGNAL);
      }
    }
    await result;
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
