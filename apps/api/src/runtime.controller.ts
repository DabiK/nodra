import { Body, Controller, HttpCode, Inject, Post } from "@nestjs/common";
import type { DispatchWorkflowOutbox, ReconcileWorkflows } from "@nodra/application";
import { DomainError } from "@nodra/application";
import { DISPATCH_WORKFLOW_OUTBOX, RECONCILE_WORKFLOWS } from "./tokens.js";

@Controller("api/runtime/temporal")
export class RuntimeController {
  constructor(
    @Inject(DISPATCH_WORKFLOW_OUTBOX) private readonly dispatchOutbox: DispatchWorkflowOutbox,
    @Inject(RECONCILE_WORKFLOWS) private readonly reconcileWorkflows: ReconcileWorkflows
  ) {}

  @Post("dispatch")
  @HttpCode(202)
  dispatch(@Body() value: unknown) {
    const body = this.objectBody(value);
    const unexpected = Object.keys(body).filter((key) => key !== "limit");
    if (unexpected.length > 0) throw new DomainError("Unexpected dispatch field", "REQUEST_INVALID");
    const limit = body.limit ?? 100;
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 1000) {
      throw new DomainError("limit must be an integer from 1 to 1000", "REQUEST_INVALID");
    }
    return this.dispatchOutbox.execute({ limit: Number(limit), occurredAt: new Date().toISOString() });
  }

  @Post("reconcile")
  @HttpCode(200)
  reconcile(@Body() value: unknown) {
    const body = this.objectBody(value);
    if (Object.keys(body).length > 0) throw new DomainError("Reconcile body must be empty", "REQUEST_INVALID");
    return this.reconcileWorkflows.execute();
  }

  private objectBody(value: unknown): Record<string, unknown> {
    if (value === undefined || value === null) return {};
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new DomainError("A JSON object body is required", "REQUEST_INVALID");
    }
    return value as Record<string, unknown>;
  }
}
