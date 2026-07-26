import type { IntegrationMethod, RepositoryIdentity, WorkspaceGitSnapshot } from "./workspace-model.js";

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
}
