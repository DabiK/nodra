import type { PipelineRepository } from "./pipeline-repository.js";

export class ListPipelines {
  constructor(private readonly pipelines: PipelineRepository) {}

  execute() {
    return this.pipelines.list();
  }
}
