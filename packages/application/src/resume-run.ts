import { DomainError, type Id } from "@nodra/domain";
import type { RunControlRepository } from "./run-control-repository.js";
import type { WorkflowPort } from "./workflow-port.js";

export class ResumeRun {
  constructor(
    private readonly runs: RunControlRepository,
    private readonly workflows: WorkflowPort
  ) {}

  async execute(runId: Id): Promise<{ runId: Id; state: "resume_requested"; externalSessionId: string }> {
    const run = await this.runs.load(runId);
    if (!run) throw new DomainError(`Run ${runId} was not found`, "RUN_NOT_FOUND");
    if (!run.capabilities.resume.available) {
      throw new DomainError(run.capabilities.resume.reason ?? "Resume is unavailable", "CAPABILITY_UNAVAILABLE");
    }
    if (!run.providerSessionRef) {
      throw new DomainError("No persisted provider session is available", "PROVIDER_SESSION_REQUIRED");
    }
    await this.workflows.signal(run.temporalParentWorkflowId, { type: "resume" });
    return { runId, state: "resume_requested", externalSessionId: run.providerSessionRef };
  }
}
