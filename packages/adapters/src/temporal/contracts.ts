export interface MissionWorkflowInput {
  missionId: string;
  commandId: string;
  schemaVersion: 1;
}

export interface MissionWorkflowStartedRequest {
  missionId: string;
  commandId: string;
  messageId: string;
  schemaVersion: 1;
}

export interface MissionWorkflowStartedInput extends MissionWorkflowStartedRequest {
  temporalRunId: string;
  occurredAt: string;
}

export interface MissionWorkflowStartedResult {
  applied: boolean;
}

export interface MissionWorkflowActivities {
  recordStarted(input: MissionWorkflowStartedRequest): Promise<MissionWorkflowStartedResult>;
}

export interface MissionWorkflowStatus {
  phase: "starting" | "started" | "cancelled";
  missionId: string;
  commandId: string;
  schemaVersion: 1;
}
