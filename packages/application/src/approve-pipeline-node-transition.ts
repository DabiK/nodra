import { DomainError } from "@nodra/domain";
import type { ApprovePipelineNodeTransitionInput, PipelineRepository } from "./pipeline-repository.js";

export class ApprovePipelineNodeTransition {
  constructor(private readonly pipelines: PipelineRepository) {}

  execute(input: ApprovePipelineNodeTransitionInput) {
    if (!input.nodeKey.trim()) throw new DomainError("Pipeline node key is required", "PIPELINE_NODE_KEY_REQUIRED");
    return this.pipelines.approveNodeTransition(input);
  }
}
