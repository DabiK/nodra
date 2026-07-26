import type { AdvancePipelineInput, PipelineRepository } from "./pipeline-repository.js";

export class AdvancePipeline {
  constructor(private readonly pipelines: PipelineRepository) {}

  execute(input: AdvancePipelineInput) {
    return this.pipelines.advance(input);
  }
}
