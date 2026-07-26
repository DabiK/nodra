import { DomainError } from "@nodra/domain";
import type { CreatePipelineInput, PipelineRepository } from "./pipeline-repository.js";

export class CreatePipeline {
  constructor(private readonly pipelines: PipelineRepository) {}

  execute(input: CreatePipelineInput) {
    if (!input.name.trim()) throw new DomainError("Pipeline name is required", "PIPELINE_NAME_REQUIRED");
    if (input.nodes.length < 2) throw new DomainError("A pipeline requires at least two mission nodes", "PIPELINE_TOO_SMALL");
    const keys = new Set<string>();
    for (const node of input.nodes) {
      if (!node.nodeKey.trim()) throw new DomainError("Pipeline node key is required", "PIPELINE_NODE_KEY_REQUIRED");
      if (keys.has(node.nodeKey)) throw new DomainError(`Duplicate pipeline node key ${node.nodeKey}`, "PIPELINE_NODE_DUPLICATE");
      keys.add(node.nodeKey);
    }
    return this.pipelines.create(input);
  }
}
