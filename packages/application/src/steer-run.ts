import { DomainError, type Id } from "@nodra/domain";
import type { RunControlRepository } from "./run-control-repository.js";
import type { WorkflowPort } from "./workflow-port.js";

export class SteerRun {
  constructor(
    private readonly runs: RunControlRepository,
    private readonly workflows: WorkflowPort
  ) {}

  async execute(runId: Id, text: string): Promise<{ runId: Id; state: "steer_requested" }> {
    if (!text.trim()) throw new DomainError("Steer text is required", "RUN_COMMAND_INVALID");
    const run = await this.runs.load(runId);
    if (!run) throw new DomainError(`Run ${runId} was not found`, "RUN_NOT_FOUND");
    if (!run.capabilities.steer.available || run.capabilities.steer.mode !== "immediate") {
      throw new DomainError(run.capabilities.steer.reason ?? "Steer is unavailable", "CAPABILITY_UNAVAILABLE");
    }
    await this.workflows.signal(run.temporalParentWorkflowId, { type: "steer", text: text.trim(), mode: "immediate" });
    return { runId, state: "steer_requested" };
  }
}
