import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type { ManageConfirmations } from "@nodra/application";
import { toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import { commandContext } from "./command-context.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { RequestConfirmationDto } from "./dto/confirmation.dto.js";
import { DecideConfirmationDto } from "./dto/decide-confirmation.dto.js";
import { MANAGE_CONFIRMATIONS } from "./tokens.js";

@Controller("api/confirmations")
export class ConfirmationController {
  constructor(
    @Inject(MANAGE_CONFIRMATIONS)
    private readonly confirmations: ManageConfirmations
  ) {}

  @Post()
  request(@Body() body: RequestConfirmationDto) {
    return this.confirmations.request({
      id: toId(randomUUID()),
      action: body.action,
      target: body.target,
      cwd: body.cwd ?? null,
      providerId: body.providerId ?? null,
      permissionPreset: body.permissionPreset ?? null,
      risk: body.risk,
      scope: body.scope,
      ...(body.runId === undefined ? {} : { runId: toId(body.runId) }),
      ...(body.missionId === undefined ? {} : { missionId: toId(body.missionId) }),
      ...(body.workspaceId === undefined ? {} : { workspaceId: toId(body.workspaceId) }),
      expiresAt: body.expiresAt,
      context: commandContext(body.commandId)
    });
  }

  @Get(":id")
  show(@Param("id") id: string) {
    return this.confirmations.show(toId(id));
  }

  @Post(":id/decide")
  decide(@Param("id") id: string, @Body() body: DecideConfirmationDto) {
    return this.confirmations.decide({
      id: toId(id),
      decision: body.decision,
      actor: body.actor,
      comment: body.comment,
      context: commandContext(body.commandId)
    });
  }

}
