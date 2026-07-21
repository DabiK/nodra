export interface MissionWorkflowInput {
  missionId: string;
  commandId: string;
  runId: string;
  schemaVersion: 1;
}

export interface RunWorkflowInput {
  missionId: string;
  commandId: string;
  runId: string;
  snapshotVersion: 1;
  schemaVersion: 1;
}

export interface RunWorkflowStartedRequest {
  missionId: string;
  commandId: string;
  runId: string;
  messageId: string;
  schemaVersion: 1;
}

export interface RunWorkflowStartedInput extends RunWorkflowStartedRequest {
  temporalRunId: string;
  occurredAt: string;
}

export interface RunWorkflowStartedResult {
  applied: boolean;
}

export interface RunWorkflowActivities {
  recordStarted(input: RunWorkflowStartedRequest): Promise<RunWorkflowStartedResult>;
}

export interface MissionWorkflowStatus {
  phase: "starting" | "started" | "cancelled";
  missionId: string;
  commandId: string;
  runId: string;
  childWorkflowId: string;
  schemaVersion: 1;
}
