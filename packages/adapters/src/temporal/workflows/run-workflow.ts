import {
  CancellationScope,
  condition,
  defineSignal,
  isCancellation,
  proxyActivities,
  setHandler
} from "@temporalio/workflow";
import type { RunWorkflowActivities, RunWorkflowInput } from "../contracts.js";
import { MISSION_RESUME_SIGNAL, MISSION_STEER_SIGNAL } from "../temporal-settings.js";

const activities = proxyActivities<RunWorkflowActivities>({
  startToCloseTimeout: "10 seconds",
  scheduleToCloseTimeout: "1 minute",
  retry: { initialInterval: "1 second", maximumInterval: "10 seconds", maximumAttempts: 5 }
});

const providerActivities = proxyActivities<Pick<RunWorkflowActivities, "executeProvider">>({
  startToCloseTimeout: "7 days",
  heartbeatTimeout: "5 seconds",
  retry: { maximumAttempts: 1 },
  cancellationType: "WAIT_CANCELLATION_COMPLETED"
});

const controlActivities = proxyActivities<Pick<RunWorkflowActivities, "steerProvider">>({
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 1 }
});

const steerRunSignal = defineSignal<[string]>(MISSION_STEER_SIGNAL);
const resumeRunSignal = defineSignal(MISSION_RESUME_SIGNAL);

export async function RunWorkflow(input: RunWorkflowInput): Promise<void> {
  const steerQueue: string[] = [];
  let resumeRequested = false;
  setHandler(steerRunSignal, (text) => {
    steerQueue.push(text);
  });
  setHandler(resumeRunSignal, () => {
    resumeRequested = true;
  });
  try {
    await activities.recordStarted({
      missionId: input.missionId,
      ...(input.managerId ? { managerId: input.managerId } : {}),
      ...(input.subjectKind ? { subjectKind: input.subjectKind } : {}),
      commandId: input.commandId,
      runId: input.runId,
      messageId: `run/${input.runId}/activity/record-started/v${input.schemaVersion}`,
      schemaVersion: input.schemaVersion
    });
    if (!input.executeProvider) {
      await condition(() => false);
    }
    let terminalState: "SUCCEEDED" | "FAILED" | "CANCELLED" | null = null;
    while (!terminalState) {
      let outcome: { state: "SUCCEEDED" | "FAILED" | "CANCELLED" } | null = null;
      let providerError: unknown = null;
      const execution = providerActivities.executeProvider({ runId: input.runId })
        .then((result) => { outcome = result; })
        .catch((error: unknown) => { providerError = error; });
      while (!outcome && !providerError) {
        await condition(() => outcome !== null || providerError !== null || steerQueue.length > 0);
        while (steerQueue.length > 0) {
          const text = steerQueue.shift();
          if (text) await controlActivities.steerProvider({ runId: input.runId, text });
        }
      }
      await execution;
      if (providerError && isCancellation(providerError)) throw providerError;
      if (outcome) {
        terminalState = (outcome as { state: "SUCCEEDED" | "FAILED" | "CANCELLED" }).state;
        break;
      }
      await condition(() => resumeRequested);
      resumeRequested = false;
    }
    await activities.recordTerminal({
      missionId: input.missionId,
      ...(input.managerId ? { managerId: input.managerId } : {}),
      ...(input.subjectKind ? { subjectKind: input.subjectKind } : {}),
      commandId: input.commandId,
      runId: input.runId,
      messageId: `run/${input.runId}/activity/record-terminal/v${input.schemaVersion}`,
      state: terminalState,
      schemaVersion: input.schemaVersion
    });
  } catch (error) {
    await CancellationScope.nonCancellable(() => activities.recordTerminal({
      missionId: input.missionId,
      ...(input.managerId ? { managerId: input.managerId } : {}),
      ...(input.subjectKind ? { subjectKind: input.subjectKind } : {}),
      commandId: input.commandId,
      runId: input.runId,
      messageId: `run/${input.runId}/activity/record-terminal/v${input.schemaVersion}`,
      state: isCancellation(error) ? "CANCELLED" : "FAILED",
      schemaVersion: input.schemaVersion
    }));
    throw error;
  }
}
