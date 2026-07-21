import { DomainError } from "@nodra/domain";

export class WorkflowUnavailableError extends DomainError {

  constructor() {
    super("Temporal runtime is unavailable", "RUNTIME_UNHEALTHY");
    this.name = "WorkflowUnavailableError";
  }
}
