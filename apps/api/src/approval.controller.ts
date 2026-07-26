import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type { ApprovalSubject, ManageApprovals } from "@nodra/application";
import { toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import { commandContext } from "./command-context.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { RequestApprovalDto } from "./dto/approval.dto.js";
import { DecideApprovalDto } from "./dto/decide-approval.dto.js";
import { MANAGE_APPROVALS } from "./tokens.js";

@Controller("api/approvals")
export class ApprovalController {
  constructor(@Inject(MANAGE_APPROVALS) private readonly approvals: ManageApprovals) {}
  @Post() request(@Body() body: RequestApprovalDto) {
    const type = body.subjectType; const id = toId(body.subjectId);
    const subject: ApprovalSubject = type === "run" ? { runId: id } : type === "mission" ? { missionId: id } : { managerId: id };
    return this.approvals.request({ id: toId(randomUUID()), subject, kind: body.kind, ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }), context: commandContext(body.commandId) });
  }
  @Get(":id") show(@Param("id") id: string) { return this.approvals.show(toId(id)); }
  @Post(":id/decide") decide(@Param("id") id: string, @Body() body: DecideApprovalDto) { return this.approvals.decide({ id: toId(id), decision: body.decision, actor: body.actor, comment: body.comment, context: commandContext(body.commandId) }); }
}
