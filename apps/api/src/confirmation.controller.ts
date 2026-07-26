import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type { ConfirmationScope, ManageConfirmations } from "@nodra/application";
import { toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import {
  assertKeys,
  commandContext,
  objectBody,
  requiredString
} from "./http-validation.js";
import { MANAGE_CONFIRMATIONS } from "./tokens.js";

@Controller("api/confirmations")
export class ConfirmationController {
  constructor(
    @Inject(MANAGE_CONFIRMATIONS)
    private readonly confirmations: ManageConfirmations
  ) {}

  @Post()
  request(@Body() value: unknown) {
    const body = objectBody(value);
    assertKeys(body, [
      "action", "target", "cwd", "providerId", "permissionPreset", "risk", "scope",
      "runId", "missionId", "workspaceId", "expiresAt", "commandId"
    ]);
    const scope = requiredString(body.scope, "scope") as ConfirmationScope;
    if (!["once", "run", "mission"].includes(scope)) {
      return requiredString(undefined, "scope");
    }
    const target = objectBody(body.target);
    return this.confirmations.request({
      id: toId(randomUUID()),
      action: requiredString(body.action, "action"),
      target,
      cwd: this.optionalString(body.cwd, "cwd"),
      providerId: this.optionalString(body.providerId, "providerId"),
      permissionPreset: this.permissionPreset(body.permissionPreset),
      risk: requiredString(body.risk, "risk"),
      scope,
      ...(typeof body.runId === "string" ? { runId: toId(body.runId) } : {}),
      ...(typeof body.missionId === "string" ? { missionId: toId(body.missionId) } : {}),
      ...(typeof body.workspaceId === "string" ? { workspaceId: toId(body.workspaceId) } : {}),
      expiresAt: requiredString(body.expiresAt, "expiresAt"),
      context: commandContext(body.commandId)
    });
  }

  @Get(":id")
  show(@Param("id") id: string) {
    return this.confirmations.show(toId(id));
  }

  @Post(":id/decide")
  decide(@Param("id") id: string, @Body() value: unknown) {
    const body = objectBody(value);
    assertKeys(body, ["decision", "actor", "comment", "commandId"]);
    const decision = requiredString(body.decision, "decision");
    if (decision !== "approved" && decision !== "denied") {
      return requiredString(undefined, "decision");
    }
    return this.confirmations.decide({
      id: toId(id),
      decision,
      actor: requiredString(body.actor, "actor"),
      comment: requiredString(body.comment, "comment"),
      context: commandContext(body.commandId)
    });
  }

  private optionalString(value: unknown, name: string): string | null {
    if (value === undefined || value === null) return null;
    return requiredString(value, name);
  }

  private permissionPreset(
    value: unknown
  ): "read_only" | "workspace" | "full_access" | null {
    if (value === undefined || value === null) return null;
    const preset = requiredString(value, "permissionPreset");
    if (!["read_only", "workspace", "full_access"].includes(preset)) {
      return requiredString(undefined, "permissionPreset") as never;
    }
    return preset as "read_only" | "workspace" | "full_access";
  }
}
