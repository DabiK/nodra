import { DomainError, type Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type { WorkspaceKind, WorkspaceRecord } from "./workspace-model.js";
import type { WorkspacePort } from "./workspace-port.js";
import type { WorkspaceRepository } from "./workspace-repository.js";

export class CreateWorkspace {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly workspace: WorkspacePort
  ) {}

  async execute(input: {
    id: Id;
    projectId?: Id | null;
    kind: WorkspaceKind;
    path: string;
    sourceWorkspaceId?: Id;
    baseRef?: string;
    branchName?: string;
    integrationTargetRef?: string | null;
    context: CommandContext;
  }): Promise<WorkspaceRecord> {
    const replay = await this.repository.findCommand(input.context.commandId);
    if (replay) return replay;
    if (!input.path.trim()) throw new DomainError("Workspace path is required", "REQUEST_INVALID");
    if (input.kind === "repo") {
      const fallbackPath = await this.workspace.canonicalizeExisting(input.path);
      let identity: Awaited<ReturnType<WorkspacePort["inspectRepository"]>> | null = null;
      let snapshot: Awaited<ReturnType<WorkspacePort["snapshot"]>> | null = null;
      try {
        identity = await this.workspace.inspectRepository(input.path);
        snapshot = await this.workspace.snapshot(identity.canonicalPath);
      } catch {
        identity = null;
        snapshot = null;
      }
      return this.repository.create({
        id: input.id,
        projectId: input.projectId ?? null,
        kind: input.kind,
        path: identity?.canonicalPath ?? fallbackPath,
        repository: identity,
        baseRef: identity?.head ?? null,
        branchName: identity?.branchName ?? null,
        integrationTargetRef: input.integrationTargetRef ?? null,
        snapshot,
        context: input.context
      });
    }
    if (input.kind === "scratch") {
      if (input.sourceWorkspaceId || input.baseRef || input.branchName) {
        throw new DomainError("Scratch workspace cannot have Git source options", "REQUEST_INVALID");
      }
      let path: string;
      try {
        path = await this.workspace.createScratch(input.path);
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "WORKSPACE_PATH_CONFLICT") throw error;
        path = await this.workspace.canonicalizeExisting(input.path);
      }
      return this.repository.create({
        id: input.id,
        projectId: input.projectId ?? null,
        kind: input.kind,
        path,
        repository: null,
        baseRef: null,
        branchName: null,
        integrationTargetRef: null,
        snapshot: null,
        context: input.context
      });
    }
    if (!input.sourceWorkspaceId || !input.baseRef?.trim() || !input.branchName?.trim()) {
      throw new DomainError("Worktree source, baseRef and branchName are required", "REQUEST_INVALID");
    }
    const source = await this.repository.read(input.sourceWorkspaceId);
    if (!source.repository || source.state === "deleted") {
      throw new DomainError("Worktree source repository is unavailable", "WORKSPACE_STATE_CONFLICT");
    }
    const created = await this.workspace.createWorktree({
      sourcePath: source.path,
      requestedPath: input.path,
      branchName: input.branchName,
      baseRef: input.baseRef
    });
    const snapshot = await this.workspace.snapshot(created.path);
    return this.repository.create({
      id: input.id,
      projectId: input.projectId ?? source.projectId,
      kind: input.kind,
      path: created.path,
      repository: created.repository,
      baseRef: input.baseRef,
      branchName: input.branchName,
      integrationTargetRef: input.integrationTargetRef ?? null,
      snapshot,
      context: input.context
    });
  }
}
