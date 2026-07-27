import { DomainError, type Id } from "@nodra/domain";
import type { WorkspaceRecord, WorktreeStatus } from "./workspace-model.js";
import type { WorkspacePort } from "./workspace-port.js";
import type { WorkspaceRepository } from "./workspace-repository.js";

export type WorktreeResolutionAction = "remove-all" | "keep-branch";

export interface WorktreeResolutionResult {
  status: WorktreeStatus;
  action: WorktreeResolutionAction;
  worktreeRemoved: boolean;
  branchDeleted: boolean;
  branchKept: boolean;
  branchName: string | null;
}

/**
 * End-of-task resolution for git worktrees. Never deletes anything without an
 * explicit action, and never force-deletes silently: uncommitted changes and
 * unmerged commits require explicit confirmation flags. The task branch is only
 * deleted AFTER the worktree has been removed successfully.
 */
export class ResolveWorktree {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly workspace: WorkspacePort
  ) {}

  /** Live status used by the UI to warn about data loss before resolving. */
  async status(workspaceId: Id): Promise<WorktreeStatus> {
    const record = await this.repository.read(workspaceId);
    this.assertWorktree(record);
    return this.inspect(record);
  }

  async execute(input: {
    workspaceId: Id;
    action: WorktreeResolutionAction;
    /** Allow forced removal of a worktree that has uncommitted changes. */
    confirmDiscardChanges?: boolean;
    /** Allow deleting a task branch that still holds unmerged commits. */
    confirmDeleteUnmerged?: boolean;
  }): Promise<WorktreeResolutionResult> {
    const key = String(input.workspaceId);
    // A single resolution may run at a time per worktree (no double submissions).
    if (this.inFlight.has(key)) {
      throw new DomainError("A resolution is already in progress for this worktree", "WORKTREE_RESOLUTION_IN_PROGRESS");
    }
    this.inFlight.add(key);
    try {
      const record = await this.repository.read(input.workspaceId);
      this.assertWorktree(record);
      const status = await this.inspect(record);

      // Safety gate BEFORE any destructive command so we never leave a partial
      // state because a required confirmation was missing.
      if (status.worktreeExists && status.hasUncommittedChanges && !input.confirmDiscardChanges) {
        throw new DomainError("Worktree has uncommitted changes; explicit confirmation required", "WORKTREE_UNCOMMITTED_CHANGES");
      }
      if (input.action === "remove-all" && status.branchExists && status.hasUnmergedCommits && !input.confirmDeleteUnmerged) {
        throw new DomainError("Task branch has unmerged commits; explicit confirmation required", "WORKTREE_BRANCH_UNMERGED");
      }

      const mainRepositoryPath = status.mainRepositoryPath;
      let worktreeRemoved = false;
      if (status.worktreeExists) {
        if (!mainRepositoryPath) {
          throw new DomainError("Cannot resolve the main repository for this worktree", "WORKSPACE_STATE_CONFLICT");
        }
        await this.workspace.removeWorktree({
          mainRepositoryPath,
          worktreePath: record.path,
          force: status.hasUncommittedChanges
        });
        worktreeRemoved = true;
      } else if (mainRepositoryPath) {
        // Directory already removed manually: prune the stale registration.
        await this.workspace.removeWorktree({ mainRepositoryPath, worktreePath: record.path, force: true });
      }

      let branchDeleted = false;
      let branchKept = false;
      const branchName = status.branchName;
      if (input.action === "remove-all") {
        // Branch deletion happens only after the worktree removal above.
        if (mainRepositoryPath && branchName && status.branchExists) {
          await this.workspace.deleteWorktreeBranch({
            mainRepositoryPath,
            branchName,
            force: status.hasUnmergedCommits
          });
          branchDeleted = true;
        }
      } else {
        branchKept = status.branchExists;
      }

      return { status, action: input.action, worktreeRemoved, branchDeleted, branchKept, branchName };
    } finally {
      this.inFlight.delete(key);
    }
  }

  private inspect(record: WorkspaceRecord): Promise<WorktreeStatus> {
    return this.workspace.inspectWorktree({
      worktreePath: record.path,
      baseRef: record.repository?.baseRef ?? null,
      branchName: record.repository?.branchName ?? null
    });
  }

  private assertWorktree(record: WorkspaceRecord): void {
    if (record.kind !== "worktree") {
      throw new DomainError("Workspace is not a git worktree", "REQUEST_INVALID");
    }
    if (record.state === "deleted") {
      throw new DomainError("Workspace has already been deleted", "WORKSPACE_STATE_CONFLICT");
    }
  }
}
