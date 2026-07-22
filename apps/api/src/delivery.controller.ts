import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type { ManageDelivery } from "@nodra/application";
import { toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import { assertKeys, commandContext, integer, objectBody, requiredString } from "./http-validation.js";
import { MANAGE_DELIVERY } from "./tokens.js";

@Controller("api/runs/:runId/delivery")
export class DeliveryController {
  constructor(@Inject(MANAGE_DELIVERY) private readonly delivery: ManageDelivery) {}
  @Get() show(@Param("runId") runId: string) { return this.delivery.show(toId(runId)); }
  @Post("declare") declare(@Param("runId") runId: string, @Body() value: unknown) { const body = objectBody(value); assertKeys(body, ["agentDeclaration", "observationSummary", "expectedMissionVersion", "commandId"]); return this.delivery.declare({ id: toId(randomUUID()), runId: toId(runId), agentDeclaration: requiredString(body.agentDeclaration, "agentDeclaration"), observationSummary: typeof body.observationSummary === "string" ? body.observationSummary : "", expectedMissionVersion: integer(body.expectedMissionVersion, "expectedMissionVersion"), context: commandContext(body.commandId) }); }
  @Post("accept") accept(@Param("runId") runId: string, @Body() value: unknown) { return this.decide(runId, value, "accept"); }
  @Post("request-changes") requestChanges(@Param("runId") runId: string, @Body() value: unknown) { return this.decide(runId, value, "request-changes"); }
  @Post("reject") reject(@Param("runId") runId: string, @Body() value: unknown) { return this.decide(runId, value, "reject"); }
  private decide(runId: string, value: unknown, decision: "accept"|"request-changes"|"reject") { const body = objectBody(value); assertKeys(body, ["comment", "expectedMissionVersion", "commandId"]); return this.delivery.decide({ runId: toId(runId), decision, comment: requiredString(body.comment, "comment"), expectedMissionVersion: integer(body.expectedMissionVersion, "expectedMissionVersion"), context: commandContext(body.commandId) }); }
}
