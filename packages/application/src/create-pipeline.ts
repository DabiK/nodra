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
    for (const edge of input.edges ?? []) {
      if (!keys.has(edge.fromNodeKey)) throw new DomainError(`Unknown pipeline edge source ${edge.fromNodeKey}`, "PIPELINE_EDGE_INVALID");
      if (!keys.has(edge.toNodeKey)) throw new DomainError(`Unknown pipeline edge target ${edge.toNodeKey}`, "PIPELINE_EDGE_INVALID");
      if (edge.fromNodeKey === edge.toNodeKey) throw new DomainError("Pipeline edge cannot target itself", "PIPELINE_EDGE_INVALID");
    }
    this.assertAcyclic(input.nodes.map((node) => node.nodeKey), input.edges ?? this.linearEdges(input.nodes.map((node) => node.nodeKey)));
    return this.pipelines.create(input);
  }

  private linearEdges(keys: string[]) {
    return keys.slice(0, -1).map((fromNodeKey, index) => ({
      fromNodeKey,
      toNodeKey: keys[index + 1]!
    }));
  }

  private assertAcyclic(keys: string[], edges: Array<{ fromNodeKey: string; toNodeKey: string }>): void {
    const outgoing = new Map(keys.map((key) => [key, [] as string[]]));
    for (const edge of edges) outgoing.get(edge.fromNodeKey)!.push(edge.toNodeKey);
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (key: string): void => {
      if (visited.has(key)) return;
      if (visiting.has(key)) throw new DomainError("Pipeline edges must not contain a cycle", "PIPELINE_CYCLE");
      visiting.add(key);
      for (const next of outgoing.get(key) ?? []) visit(next);
      visiting.delete(key);
      visited.add(key);
    };
    for (const key of keys) visit(key);
  }
}
