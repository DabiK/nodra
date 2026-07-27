import type { Id } from "@nodra/domain";
import type { ProviderReasoningEffort } from "@nodra/application";

export interface OpenCodeActiveRun {
  sessionId: string;
  cwd: string;
  modelId: string;
  reasoningEffort: ProviderReasoningEffort;
  stopEvents: AbortController;
}

export class OpenCodeRunSupervisor {
  private readonly active = new Map<Id, OpenCodeActiveRun>();

  attach(runId: Id, run: OpenCodeActiveRun): void {
    if (this.active.has(runId)) throw new Error(`OpenCode run ${runId} is already active`);
    this.active.set(runId, run);
  }

  get(runId: string): OpenCodeActiveRun | undefined {
    return this.active.get(runId as Id);
  }

  release(runId: Id): void {
    this.active.get(runId)?.stopEvents.abort();
    this.active.delete(runId);
  }
}
