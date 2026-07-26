import type { StartPipelineInput, PipelineRepository } from "./pipeline-repository.js";

export class StartPipeline {
  constructor(private readonly pipelines: PipelineRepository) {}

  execute(input: StartPipelineInput) {
    return this.pipelines.start(input);
  }
}
