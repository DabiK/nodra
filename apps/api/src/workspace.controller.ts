import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type {
  CommitWorkspace,
  CreateWorkspace,
  DeleteWorkspace,
  IntegrateWorkspace,
  ReadWorkspace,
  RestoreWorkspace,
  SnapshotWorkspace,
} from "@nodra/application";
import { toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import { commandContext } from "./command-context.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { CreateWorkspaceDto } from "./dto/workspace.dto.js";
import { SnapshotWorkspaceDto } from "./dto/snapshot-workspace.dto.js";
import { CommitWorkspaceDto } from "./dto/commit-workspace.dto.js";
import { IntegrateWorkspaceDto } from "./dto/integrate-workspace.dto.js";
import { DeleteWorkspaceDto } from "./dto/delete-workspace.dto.js";
import { RestoreWorkspaceDto } from "./dto/restore-workspace.dto.js";
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
  create(@Body() body: CreateWorkspaceDto) {
    return this.createWorkspace.execute({
      id: toId(body.id ?? randomUUID()),
      ...(body.projectId === undefined ? {} : { projectId: toId(body.projectId) }),
      kind: body.kind,
      path: body.path,
      ...(body.sourceWorkspaceId !== undefined
        ? { sourceWorkspaceId: toId(body.sourceWorkspaceId) }
        : {}),
      ...(body.baseRef !== undefined ? { baseRef: body.baseRef } : {}),
      ...(body.branchName !== undefined ? { branchName: body.branchName } : {}),
      ...(body.integrationTargetRef !== undefined
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
  snapshot(@Param("id") id: string, @Body() body: SnapshotWorkspaceDto) {
    const context = commandContext(body.commandId);
    return this.snapshotWorkspace.execute({
      workspaceId: toId(id),
      snapshotId: toId(`${context.commandId}/snapshot`),
      reason: body.reason,
      context
    });
  }

  @Post(":id/commit")
  commit(@Param("id") id: string, @Body() body: CommitWorkspaceDto) {
    return this.commitWorkspace.execute({
      workspaceId: toId(id),
      missionId: toId(body.missionId),
      message: body.message,
      ...(body.confirmationId !== undefined
        ? { confirmationId: toId(body.confirmationId) }
        : {}),
      context: commandContext(body.commandId)
    });
  }

  @Post(":id/integrate")
  integrate(@Param("id") id: string, @Body() body: IntegrateWorkspaceDto) {
    return this.integrateWorkspace.execute({
      workspaceId: toId(id),
      method: body.method,
      sourceRef: body.sourceRef,
      targetRef: body.targetRef,
      ...(body.confirmationId !== undefined
        ? { confirmationId: toId(body.confirmationId) }
        : {}),
      context: commandContext(body.commandId)
    });
  }

  @Post(":id/delete")
  delete(@Param("id") id: string, @Body() body: DeleteWorkspaceDto) {
    return this.deleteWorkspace.execute({
      workspaceId: toId(id),
      ...(body.confirmationId !== undefined
        ? { confirmationId: toId(body.confirmationId) }
        : {}),
      context: commandContext(body.commandId)
    });
  }

  @Post(":id/restore")
  restore(@Param("id") id: string, @Body() body: RestoreWorkspaceDto) {
    return this.restoreWorkspace.execute({
      workspaceId: toId(id),
      context: commandContext(body.commandId)
    });
  }
}
