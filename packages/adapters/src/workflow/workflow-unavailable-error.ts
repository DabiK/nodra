export class WorkflowUnavailableError extends Error {
  readonly code = "WORKFLOW_UNAVAILABLE";

  constructor() {
    super("Temporal runtime is deliberately absent from this increment");
    this.name = "WorkflowUnavailableError";
  }
}
