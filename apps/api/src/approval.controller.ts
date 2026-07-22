import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type { ApprovalSubject, ManageApprovals } from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import { assertKeys, commandContext, objectBody, requiredString } from "./http-validation.js";
import { MANAGE_APPROVALS } from "./tokens.js";

@Controller("api/approvals")
export class ApprovalController {
  constructor(@Inject(MANAGE_APPROVALS) private readonly approvals: ManageApprovals) {}
  @Post() request(@Body() value: unknown) {
    const body = objectBody(value); assertKeys(body, ["subjectType", "subjectId", "kind", "expiresAt", "commandId"]);
    const type = requiredString(body.subjectType, "subjectType"); const id = toId(requiredString(body.subjectId, "subjectId"));
    if (!["run", "mission", "manager"].includes(type)) throw new DomainError("subjectType is invalid", "REQUEST_INVALID");
    if (body.expiresAt !== undefined && typeof body.expiresAt !== "string") throw new DomainError("expiresAt must be a string", "REQUEST_INVALID");
    const subject: ApprovalSubject = type === "run" ? { runId: id } : type === "mission" ? { missionId: id } : { managerId: id };
    return this.approvals.request({ id: toId(randomUUID()), subject, kind: requiredString(body.kind, "kind"), ...(typeof body.expiresAt === "string" ? { expiresAt: body.expiresAt } : {}), context: commandContext(body.commandId) });
  }
  @Get(":id") show(@Param("id") id: string) { return this.approvals.show(toId(id)); }
  @Post(":id/decide") decide(@Param("id") id: string, @Body() value: unknown) { const body = objectBody(value); assertKeys(body, ["decision", "actor", "comment", "commandId"]); if (!["approved", "denied"].includes(String(body.decision))) throw new DomainError("decision is invalid", "REQUEST_INVALID"); return this.approvals.decide({ id: toId(id), decision: body.decision as "approved"|"denied", actor: requiredString(body.actor, "actor"), comment: requiredString(body.comment, "comment"), context: commandContext(body.commandId) }); }
}
