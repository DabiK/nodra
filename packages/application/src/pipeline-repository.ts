import type { Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type {
  PipelineAdvanceResult,
  PipelineEdgeInput,
  PipelineListItemView,
  PipelineNodeInput,
  PipelineTransitionApprovalResult,
  PipelineTransitionModeResult,
  PipelineHandoverPublishResult,
  PipelineRunView,
  PipelineView
} from "./pipeline-model.js";

export interface CreatePipelineInput {
  pipelineId: Id;
  definitionId: Id;
  nodeIdPrefix: string;
  edgeIdPrefix: string;
  name: string;
  projectId?: Id | null;
  nodes: PipelineNodeInput[];
  edges?: PipelineEdgeInput[];
  context: CommandContext;
}

export interface StartPipelineInput {
  pipelineId: Id;
  pipelineRunId: Id;
  nodeRunIdPrefix: string;
  context: CommandContext;
}

export interface AdvancePipelineInput {
  pipelineRunId: Id;
  context: CommandContext;
  startMission: (missionId: Id, handoverPrompt: string | null) => Promise<void>;
}

export interface SetPipelineNodeTransitionModeInput {
  pipelineRunId: Id;
  nodeKey: string;
  mode: "auto" | "human";
  context: CommandContext;
}

export interface ApprovePipelineNodeTransitionInput {
  pipelineRunId: Id;
  nodeKey: string;
  context: CommandContext;
}

export interface PublishPipelineNodeHandoverInput {
  pipelineRunId: Id;
  nodeKey: string;
  context: CommandContext;
}

export interface PipelineRepository {
  create(input: CreatePipelineInput): Promise<PipelineView>;
  list(): Promise<PipelineListItemView[]>;
  show(id: Id): Promise<PipelineView | null>;
  showRun(id: Id): Promise<PipelineRunView | null>;
  start(input: StartPipelineInput): Promise<PipelineAdvanceResult>;
  advance(input: AdvancePipelineInput): Promise<PipelineAdvanceResult>;
  setNodeTransitionMode(input: SetPipelineNodeTransitionModeInput): Promise<PipelineTransitionModeResult>;
  approveNodeTransition(input: ApprovePipelineNodeTransitionInput): Promise<PipelineTransitionApprovalResult>;
  publishNodeHandover(input: PublishPipelineNodeHandoverInput): Promise<PipelineHandoverPublishResult>;
}
