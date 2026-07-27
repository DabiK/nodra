import type { IntegrationMethod, RepositoryIdentity, WorkspaceGitSnapshot, WorktreeStatus } from "./workspace-model.js";

export interface WorkspacePort {
  canonicalizeExisting(path: string): Promise<string>;
  createScratch(requestedPath: string): Promise<string>;
  inspectRepository(requestedPath: string): Promise<RepositoryIdentity>;
  createWorktree(input: {
    sourcePath: string;
    requestedPath: string;
    branchName: string;
    baseRef: string;
  }): Promise<{ path: string; repository: RepositoryIdentity }>;
  snapshot(path: string): Promise<WorkspaceGitSnapshot>;
  commit(input: { path: string; message: string }): Promise<void>;
  integrate(input: {
    path: string;
    method: IntegrationMethod;
    sourceRef: string;
    targetRef: string;
  }): Promise<void>;
  deleteActivity(input: { path: string; kind: "scratch" | "worktree" }): Promise<void>;
  /** Inspect the live Git status of a worktree for safe end-of-task resolution. */
  inspectWorktree(input: {
    worktreePath: string;
    baseRef: string | null;
    branchName: string | null;
  }): Promise<WorktreeStatus>;
  /** Remove a worktree (arg-separated `git worktree remove` + prune). Idempotent. */
  removeWorktree(input: {
    mainRepositoryPath: string;
    worktreePath: string;
    force: boolean;
  }): Promise<void>;
  /** Delete a task branch from the main repository (arg-separated). Idempotent. */
  deleteWorktreeBranch(input: {
    mainRepositoryPath: string;
    branchName: string;
    force: boolean;
  }): Promise<void>;
}
