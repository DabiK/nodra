import type { Id } from "@nodra/domain";

export type PipelineState = "draft" | "active" | "completed" | "archived";
export type PipelineRunState = "queued" | "active" | "blocked" | "completed" | "failed" | "cancelled" | "archived";
export type PipelineNodeRunState = "pending" | "ready" | "active" | "blocked" | "completed" | "failed" | "skipped";

export interface PipelineNodeInput {
  nodeKey: string;
  missionId: Id;
}

export interface PipelineEdgeInput {
  fromNodeKey: string;
  toNodeKey: string;
}

export interface PipelineView {
  id: Id;
  projectId: Id | null;
  name: string;
  state: PipelineState;
  definition: {
    id: Id;
    version: number;
    state: "draft" | "published" | "superseded";
    nodes: Array<{
      id: Id;
      nodeKey: string;
      missionId: Id;
      startMode: "auto" | "human";
    }>;
    edges: Array<{
      id: Id;
      fromNodeId: Id;
      toNodeId: Id;
    }>;
  };
}

export interface PipelineRunView {
  id: Id;
  pipelineId: Id;
  definitionId: Id;
  state: PipelineRunState;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  nodes: Array<{
    id: Id;
    nodeId: Id;
    nodeKey: string;
    missionId: Id;
    missionKind: string;
    missionState: string;
    state: PipelineNodeRunState;
    userAttempt: number;
  }>;
}

export interface PipelineAdvanceResult {
  pipelineRun: PipelineRunView;
  startedMissionIds: Id[];
}
