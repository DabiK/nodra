import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type { ManageDelivery } from "@nodra/application";
import { toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import { commandContext } from "./command-context.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { DeclareDeliveryDto } from "./dto/delivery.dto.js";
import { DecideDeliveryDto } from "./dto/decide-delivery.dto.js";
import { MANAGE_DELIVERY } from "./tokens.js";

@Controller("api/runs/:runId/delivery")
export class DeliveryController {
  constructor(@Inject(MANAGE_DELIVERY) private readonly delivery: ManageDelivery) {}
  @Get() show(@Param("runId") runId: string) { return this.delivery.show(toId(runId)); }
  @Post("declare") declare(@Param("runId") runId: string, @Body() body: DeclareDeliveryDto) { return this.delivery.declare({ id: toId(randomUUID()), runId: toId(runId), agentDeclaration: body.agentDeclaration, observationSummary: body.observationSummary ?? "", expectedMissionVersion: body.expectedMissionVersion, context: commandContext(body.commandId) }); }
  @Post("accept") accept(@Param("runId") runId: string, @Body() body: DecideDeliveryDto) { return this.decide(runId, body, "accept"); }
  @Post("request-changes") requestChanges(@Param("runId") runId: string, @Body() body: DecideDeliveryDto) { return this.decide(runId, body, "request-changes"); }
  @Post("reject") reject(@Param("runId") runId: string, @Body() body: DecideDeliveryDto) { return this.decide(runId, body, "reject"); }
  private decide(runId: string, body: DecideDeliveryDto, decision: "accept"|"request-changes"|"reject") { return this.delivery.decide({ runId: toId(runId), decision, comment: body.comment, expectedMissionVersion: body.expectedMissionVersion, context: commandContext(body.commandId) }); }
}
