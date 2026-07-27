import type { Id } from "@nodra/domain";

export interface StartMissionInput {
  missionId?: Id;
  managerId?: Id;
  subjectKind?: "mission" | "manager";
  commandId: Id;
  runId: Id;
  schemaVersion: 1;
  executeProvider?: boolean;
}

export type WorkflowSignal =
  | { type: "cancel" }
  | { type: "resume" }
  | { type: "steer"; text: string; mode: "immediate" | "enqueue" }
  | { type: "approval"; approvalId: Id; decision: "approved" | "denied" };

export type WorkflowUpdate = { type: "retry"; runId: Id };
export type WorkflowQuery = { type: "status" };

export interface WorkflowPort {
  start(input: StartMissionInput): Promise<{ workflowId: string; runId: string }>;
  signal(id: string, signal: WorkflowSignal): Promise<void>;
  update<T>(id: string, update: WorkflowUpdate): Promise<T>;
  query<T>(id: string, query: WorkflowQuery): Promise<T>;
}
