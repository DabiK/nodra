import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type {
  CommitWorkspace,
  CreateWorkspace,
  DeleteWorkspace,
  IntegrateWorkspace,
  IntegrationMethod,
  ReadWorkspace,
  RestoreWorkspace,
  SnapshotWorkspace,
  WorkspaceKind
} from "@nodra/application";
import { toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import {
  assertKeys,
  commandContext,
  objectBody,
  requiredString
} from "./http-validation.js";
import {
  COMMIT_WORKSPACE,
  CREATE_WORKSPACE,
  DELETE_WORKSPACE,
  INTEGRATE_WORKSPACE,
  READ_WORKSPACE,
  RESTORE_WORKSPACE,
  SNAPSHOT_WORKSPACE
} from "./tokens.js";

@Controller("api/workspaces")
export class WorkspaceController {
  constructor(
    @Inject(CREATE_WORKSPACE) private readonly createWorkspace: CreateWorkspace,
    @Inject(READ_WORKSPACE) private readonly readWorkspace: ReadWorkspace,
    @Inject(SNAPSHOT_WORKSPACE) private readonly snapshotWorkspace: SnapshotWorkspace,
    @Inject(COMMIT_WORKSPACE) private readonly commitWorkspace: CommitWorkspace,
    @Inject(INTEGRATE_WORKSPACE) private readonly integrateWorkspace: IntegrateWorkspace,
    @Inject(DELETE_WORKSPACE) private readonly deleteWorkspace: DeleteWorkspace,
    @Inject(RESTORE_WORKSPACE) private readonly restoreWorkspace: RestoreWorkspace
  ) {}

  @Post()
  create(@Body() value: unknown) {
    const body = objectBody(value);
    assertKeys(body, [
      "id", "projectId", "kind", "path", "sourceWorkspaceId", "baseRef",
      "branchName", "integrationTargetRef", "commandId"
    ]);
    const kind = requiredString(body.kind, "kind") as WorkspaceKind;
    if (!["repo", "scratch", "worktree"].includes(kind)) {
      return requiredString(undefined, "kind");
    }
    return this.createWorkspace.execute({
      id: toId(typeof body.id === "string" ? body.id : randomUUID()),
      ...(typeof body.projectId === "string" ? { projectId: toId(body.projectId) } : {}),
      kind,
      path: requiredString(body.path, "path"),
      ...(typeof body.sourceWorkspaceId === "string"
        ? { sourceWorkspaceId: toId(body.sourceWorkspaceId) }
        : {}),
      ...(typeof body.baseRef === "string" ? { baseRef: body.baseRef } : {}),
      ...(typeof body.branchName === "string" ? { branchName: body.branchName } : {}),
      ...(body.integrationTargetRef === null || typeof body.integrationTargetRef === "string"
        ? { integrationTargetRef: body.integrationTargetRef }
        : {}),
      context: commandContext(body.commandId)
    });
  }

  @Get(":id")
  show(@Param("id") id: string) {
    return this.readWorkspace.execute(toId(id));
  }

  @Post(":id/snapshots")
  snapshot(@Param("id") id: string, @Body() value: unknown) {
    const body = objectBody(value);
    assertKeys(body, ["reason", "commandId"]);
    const context = commandContext(body.commandId);
    return this.snapshotWorkspace.execute({
      workspaceId: toId(id),
      snapshotId: toId(`${context.commandId}/snapshot`),
      reason: requiredString(body.reason, "reason"),
      context
    });
  }

  @Post(":id/commit")
  commit(@Param("id") id: string, @Body() value: unknown) {
    const body = objectBody(value);
    assertKeys(body, ["missionId", "message", "confirmationId", "commandId"]);
    return this.commitWorkspace.execute({
      workspaceId: toId(id),
      missionId: toId(requiredString(body.missionId, "missionId")),
      message: requiredString(body.message, "message"),
      ...(typeof body.confirmationId === "string"
        ? { confirmationId: toId(body.confirmationId) }
        : {}),
      context: commandContext(body.commandId)
    });
  }

  @Post(":id/integrate")
  integrate(@Param("id") id: string, @Body() value: unknown) {
    const body = objectBody(value);
    assertKeys(body, ["method", "sourceRef", "targetRef", "confirmationId", "commandId"]);
    return this.integrateWorkspace.execute({
      workspaceId: toId(id),
      method: requiredString(body.method, "method") as IntegrationMethod,
      sourceRef: requiredString(body.sourceRef, "sourceRef"),
      targetRef: requiredString(body.targetRef, "targetRef"),
      ...(typeof body.confirmationId === "string"
        ? { confirmationId: toId(body.confirmationId) }
        : {}),
      context: commandContext(body.commandId)
    });
  }

  @Post(":id/delete")
  delete(@Param("id") id: string, @Body() value: unknown) {
    const body = objectBody(value);
    assertKeys(body, ["confirmationId", "commandId"]);
    return this.deleteWorkspace.execute({
      workspaceId: toId(id),
      ...(typeof body.confirmationId === "string"
        ? { confirmationId: toId(body.confirmationId) }
        : {}),
      context: commandContext(body.commandId)
    });
  }

  @Post(":id/restore")
  restore(@Param("id") id: string, @Body() value: unknown) {
    const body = objectBody(value);
    assertKeys(body, ["commandId"]);
    return this.restoreWorkspace.execute({
      workspaceId: toId(id),
      context: commandContext(body.commandId)
    });
  }
}
