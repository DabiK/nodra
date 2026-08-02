import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import type {
  CommitWorkspace,
  CreateWorkspace,
  DeleteWorkspace,
  DiffWorkspace,
  IntegrateWorkspace,
  ReadWorkspace,
  ResolveWorktree,
  RestoreWorkspace,
  SnapshotWorkspace,
} from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { commandContext } from "./command-context.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { CreateWorkspaceDto } from "./dto/workspace.dto.js";
import { SnapshotWorkspaceDto } from "./dto/snapshot-workspace.dto.js";
import { CommitWorkspaceDto } from "./dto/commit-workspace.dto.js";
import { IntegrateWorkspaceDto } from "./dto/integrate-workspace.dto.js";
import { DeleteWorkspaceDto } from "./dto/delete-workspace.dto.js";
import { RestoreWorkspaceDto } from "./dto/restore-workspace.dto.js";
import { ResolveWorktreeDto } from "./dto/resolve-worktree.dto.js";
import {
  COMMIT_WORKSPACE,
  CREATE_WORKSPACE,
  DELETE_WORKSPACE,
  DIFF_WORKSPACE,
  INTEGRATE_WORKSPACE,
  READ_WORKSPACE,
  RESOLVE_WORKTREE,
  RESTORE_WORKSPACE,
  SNAPSHOT_WORKSPACE
} from "./tokens.js";

@Controller("api/workspaces")
export class WorkspaceController {
  constructor(
    @Inject(CREATE_WORKSPACE) private readonly createWorkspace: CreateWorkspace,
    @Inject(READ_WORKSPACE) private readonly readWorkspace: ReadWorkspace,
    @Inject(DIFF_WORKSPACE) private readonly diffWorkspace: DiffWorkspace,
    @Inject(SNAPSHOT_WORKSPACE) private readonly snapshotWorkspace: SnapshotWorkspace,
    @Inject(COMMIT_WORKSPACE) private readonly commitWorkspace: CommitWorkspace,
    @Inject(INTEGRATE_WORKSPACE) private readonly integrateWorkspace: IntegrateWorkspace,
    @Inject(DELETE_WORKSPACE) private readonly deleteWorkspace: DeleteWorkspace,
    @Inject(RESTORE_WORKSPACE) private readonly restoreWorkspace: RestoreWorkspace,
    @Inject(RESOLVE_WORKTREE) private readonly resolveWorktree: ResolveWorktree
  ) {}

  @Post()
  async create(@Body() body: CreateWorkspaceDto) {
    const workspaceId = body.id ?? randomUUID();
    const sourceWorkspaceId = body.sourceWorkspaceId ?? await this.createSourceWorkspace(body);
    return this.createWorkspace.execute({
      id: toId(workspaceId),
      ...(body.projectId === undefined ? {} : { projectId: toId(body.projectId) }),
      kind: body.kind,
      path: this.workspacePath(body.kind, workspaceId, body.path),
      ...(sourceWorkspaceId !== undefined
        ? { sourceWorkspaceId: toId(sourceWorkspaceId) }
        : {}),
      ...(body.baseRef !== undefined ? { baseRef: body.baseRef } : {}),
      ...(body.branchName !== undefined ? { branchName: body.branchName } : {}),
      ...(body.integrationTargetRef !== undefined
        ? { integrationTargetRef: body.integrationTargetRef }
        : {}),
      context: commandContext(body.commandId)
    });
  }

  private async createSourceWorkspace(body: CreateWorkspaceDto) {
    if (body.kind !== "worktree" || !body.sourceRepositoryPath?.trim()) return undefined;
    const sourceId = randomUUID();
    const source = await this.createWorkspace.execute({
      id: toId(sourceId),
      ...(body.projectId === undefined ? {} : { projectId: toId(body.projectId) }),
      kind: "repo",
      path: body.sourceRepositoryPath,
      context: commandContext(body.commandId)
    });
    return source.id;
  }

  private workspacePath(kind: CreateWorkspaceDto["kind"], workspaceId: string, path?: string) {
    if (path?.trim()) return path;
    if (kind === "repo") {
      throw new DomainError("Workspace path is required", "REQUEST_INVALID");
    }
    return join(process.env.NODRA_DATA_ROOT ?? join(process.cwd(), "data", "local"), "workspaces", workspaceId);
  }

  @Get(":id")
  show(@Param("id") id: string) {
    return this.readWorkspace.execute(toId(id));
  }

  @Get(":id/diff")
  diff(@Param("id") id: string, @Query("base") base?: string, @Query("head") head?: string) {
    return this.diffWorkspace.execute({
      workspaceId: toId(id),
      ...(base === undefined ? {} : { base: base || null }),
      ...(head === undefined ? {} : { head: head || null })
    });
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

  @Get(":id/worktree")
  worktreeStatus(@Param("id") id: string) {
    return this.resolveWorktree.status(toId(id));
  }

  @Post(":id/worktree/resolve")
  resolve(@Param("id") id: string, @Body() body: ResolveWorktreeDto) {
    return this.resolveWorktree.execute({
      workspaceId: toId(id),
      action: body.action,
      ...(body.confirmDiscardChanges !== undefined ? { confirmDiscardChanges: body.confirmDiscardChanges } : {}),
      ...(body.confirmDeleteUnmerged !== undefined ? { confirmDeleteUnmerged: body.confirmDeleteUnmerged } : {})
    });
  }
}
