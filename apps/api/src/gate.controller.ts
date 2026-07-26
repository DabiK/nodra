import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type { ManageGates } from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import { commandContext } from "./command-context.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { DefineGateDto } from "./dto/gate.dto.js";
import { EvaluateGateDto } from "./dto/evaluate-gate.dto.js";
import { OverrideGateDto } from "./dto/override-gate.dto.js";
import { RefreshGateStalenessDto } from "./dto/refresh-gate-staleness.dto.js";
import { MANAGE_GATES } from "./tokens.js";

@Controller("api/gates")
export class GateController {
  constructor(@Inject(MANAGE_GATES) private readonly gates: ManageGates) {}
  @Post("pipeline-bindings") unavailablePipelineBinding() { throw new DomainError("Pipeline gate bindings are unavailable before I8", "CAPABILITY_UNAVAILABLE"); }
  @Post() define(@Body() body: DefineGateDto) {
    const id = toId(randomUUID()); const occurredAt = new Date().toISOString();
    return this.gates.define({ definition: { id, name: body.name, evaluatorId: body.evaluatorId, evaluatorVersion: body.evaluatorVersion, criteriaSchemaVersion: body.criteriaSchemaVersion, criteria: body.criteria, expectedEvidence: body.expectedEvidence, createdAt: occurredAt }, missionBindingId: toId(randomUUID()), missionId: toId(body.missionId), context: { ...commandContext(body.commandId), occurredAt } });
  }
  @Get(":id/evaluations") list(@Param("id") id: string) { return this.gates.list(toId(id)); }
  @Post("bindings/:id/evaluate") evaluate(@Param("id") id: string, @Body() body: EvaluateGateDto) { return this.gates.evaluate({ evaluationId: toId(randomUUID()), bindingId: toId(id), runId: toId(body.runId), evidenceIds: body.evidenceIds.map(toId), context: commandContext(body.commandId) }); }
  @Post("runs/:runId/refresh-staleness") refresh(@Param("runId") runId: string, @Body() body: RefreshGateStalenessDto) { return this.gates.refreshStaleness({ runId: toId(runId), context: commandContext(body.commandId) }); }
  @Post(":id/override") override(@Param("id") id: string, @Body() body: OverrideGateDto) { return this.gates.override({ overrideId: toId(randomUUID()), evaluationId: toId(id), approvalId: toId(body.approvalId), decision: body.decision, comment: body.comment, context: commandContext(body.commandId) }); }
}
