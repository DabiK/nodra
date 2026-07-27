import { DomainError } from "@nodra/domain";
import type { PipelineRepository, SetPipelineNodeTransitionModeInput } from "./pipeline-repository.js";

export class SetPipelineNodeTransitionMode {
  constructor(private readonly pipelines: PipelineRepository) {}

  execute(input: SetPipelineNodeTransitionModeInput) {
    if (!input.nodeKey.trim()) throw new DomainError("Pipeline node key is required", "PIPELINE_NODE_KEY_REQUIRED");
    return this.pipelines.setNodeTransitionMode(input);
  }
}
