import type { Id } from "@nodra/domain";
import type { PipelineRepository } from "./pipeline-repository.js";

export class ShowPipeline {
  constructor(private readonly pipelines: PipelineRepository) {}

  execute(id: Id) {
    return this.pipelines.show(id);
  }
}
