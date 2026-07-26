import { Body, Controller, HttpCode, Inject, Post } from "@nestjs/common";
import type { DispatchWorkflowOutbox, ReconcileWorkflows } from "@nodra/application";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { DispatchRuntimeDto } from "./dto/runtime.dto.js";
import { ReconcileRuntimeDto } from "./dto/reconcile-runtime.dto.js";
import { DISPATCH_WORKFLOW_OUTBOX, RECONCILE_WORKFLOWS } from "./tokens.js";

@Controller("api/runtime/temporal")
export class RuntimeController {
  constructor(
    @Inject(DISPATCH_WORKFLOW_OUTBOX) private readonly dispatchOutbox: DispatchWorkflowOutbox,
    @Inject(RECONCILE_WORKFLOWS) private readonly reconcileWorkflows: ReconcileWorkflows
  ) {}

  @Post("dispatch")
  @HttpCode(202)
  dispatch(@Body() body: DispatchRuntimeDto) {
    return this.dispatchOutbox.execute({ limit: body.limit ?? 100, occurredAt: new Date().toISOString() });
  }

  @Post("reconcile")
  @HttpCode(200)
  reconcile(@Body() _body: ReconcileRuntimeDto) {
    return this.reconcileWorkflows.execute();
  }
}
