import type { Id } from "@nodra/domain";

export interface OpenCodeActiveRun {
  sessionId: string;
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
