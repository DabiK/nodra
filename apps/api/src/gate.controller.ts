import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type { ManageGates } from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import { assertKeys, commandContext, integer, objectBody, requiredString } from "./http-validation.js";
import { MANAGE_GATES } from "./tokens.js";

@Controller("api/gates")
export class GateController {
  constructor(@Inject(MANAGE_GATES) private readonly gates: ManageGates) {}
  @Post("pipeline-bindings") unavailablePipelineBinding() { throw new DomainError("Pipeline gate bindings are unavailable before I8", "CAPABILITY_UNAVAILABLE"); }
  @Post() define(@Body() value: unknown) {
    const body = objectBody(value); assertKeys(body, ["missionId", "name", "evaluatorId", "evaluatorVersion", "criteriaSchemaVersion", "criteria", "expectedEvidence", "commandId"]);
    if (!body.criteria || typeof body.criteria !== "object" || Array.isArray(body.criteria) || !body.expectedEvidence || typeof body.expectedEvidence !== "object" || Array.isArray(body.expectedEvidence)) throw new DomainError("criteria and expectedEvidence must be objects", "REQUEST_INVALID");
    const id = toId(randomUUID()); const occurredAt = new Date().toISOString();
    return this.gates.define({ definition: { id, name: requiredString(body.name, "name"), evaluatorId: requiredString(body.evaluatorId, "evaluatorId"), evaluatorVersion: requiredString(body.evaluatorVersion, "evaluatorVersion"), criteriaSchemaVersion: integer(body.criteriaSchemaVersion, "criteriaSchemaVersion"), criteria: body.criteria as Record<string, unknown>, expectedEvidence: body.expectedEvidence as Record<string, unknown>, createdAt: occurredAt }, missionBindingId: toId(randomUUID()), missionId: toId(requiredString(body.missionId, "missionId")), context: { ...commandContext(body.commandId), occurredAt } });
  }
  @Get(":id/evaluations") list(@Param("id") id: string) { return this.gates.list(toId(id)); }
  @Post("bindings/:id/evaluate") evaluate(@Param("id") id: string, @Body() value: unknown) { const body = objectBody(value); assertKeys(body, ["runId", "evidenceIds", "commandId"]); if (!Array.isArray(body.evidenceIds) || !body.evidenceIds.every((item) => typeof item === "string")) throw new DomainError("evidenceIds must be a string array", "REQUEST_INVALID"); return this.gates.evaluate({ evaluationId: toId(randomUUID()), bindingId: toId(id), runId: toId(requiredString(body.runId, "runId")), evidenceIds: (body.evidenceIds as string[]).map(toId), context: commandContext(body.commandId) }); }
  @Post("runs/:runId/refresh-staleness") refresh(@Param("runId") runId: string, @Body() value: unknown) { const body = objectBody(value); assertKeys(body, ["commandId"]); return this.gates.refreshStaleness({ runId: toId(runId), context: commandContext(body.commandId) }); }
  @Post(":id/override") override(@Param("id") id: string, @Body() value: unknown) { const body = objectBody(value); assertKeys(body, ["approvalId", "decision", "comment", "commandId"]); if (!["accept", "reject", "waive"].includes(String(body.decision))) throw new DomainError("decision is invalid", "REQUEST_INVALID"); return this.gates.override({ overrideId: toId(randomUUID()), evaluationId: toId(id), approvalId: toId(requiredString(body.approvalId, "approvalId")), decision: body.decision as "accept"|"reject"|"waive", comment: requiredString(body.comment, "comment"), context: commandContext(body.commandId) }); }
}
