import type { Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type {
  PipelineAdvanceResult,
  PipelineNodeInput,
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
  startMission: (missionId: Id) => Promise<void>;
}

export interface PipelineRepository {
  create(input: CreatePipelineInput): Promise<PipelineView>;
  show(id: Id): Promise<PipelineView | null>;
  showRun(id: Id): Promise<PipelineRunView | null>;
  start(input: StartPipelineInput): Promise<PipelineAdvanceResult>;
  advance(input: AdvancePipelineInput): Promise<PipelineAdvanceResult>;
}
