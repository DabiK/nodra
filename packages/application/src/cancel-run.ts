import { DomainError, type Id } from "@nodra/domain";
import type { RunControlRepository } from "./run-control-repository.js";
import type { WorkflowPort } from "./workflow-port.js";

export class CancelRun {
  constructor(
    private readonly runs: RunControlRepository,
    private readonly workflows: WorkflowPort
  ) {}

  async execute(runId: Id): Promise<{ runId: Id; state: "cancel_requested" }> {
    const run = await this.runs.load(runId);
    if (!run) throw new DomainError(`Run ${runId} was not found`, "RUN_NOT_FOUND");
    if (!run.capabilities.cancel.available) {
      throw new DomainError(run.capabilities.cancel.reason ?? "Cancel is unavailable", "CAPABILITY_UNAVAILABLE");
    }
    await this.workflows.signal(run.temporalParentWorkflowId, { type: "cancel" });
    return { runId, state: "cancel_requested" };
  }
}
