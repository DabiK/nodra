import { DomainError } from "@nodra/domain";
import type { PipelineRepository, PublishPipelineNodeHandoverInput } from "./pipeline-repository.js";

export class PublishPipelineNodeHandover {
  constructor(private readonly pipelines: PipelineRepository) {}

  execute(input: PublishPipelineNodeHandoverInput) {
    if (!input.nodeKey.trim()) throw new DomainError("Pipeline node key is required", "PIPELINE_NODE_KEY_REQUIRED");
    return this.pipelines.publishNodeHandover(input);
  }
}
