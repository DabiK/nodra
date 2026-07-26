import type { Id } from "@nodra/domain";

export type WorkspaceKind = "repo" | "scratch" | "worktree";
export type WorkspaceState = "ready" | "in_use" | "pending_delete" | "deleted";
export type IntegrationMethod = "merge" | "rebase" | "cherry-pick";

export interface WorkspaceGitSnapshot {
  head: string | null;
  treeDigest: string | null;
  diffDigest: string | null;
  branchName: string | null;
  capturedAt: string;
}

export interface RepositoryIdentity {
  stableIdentity: string;
  canonicalRemote: string | null;
  canonicalPath: string;
  head: string;
  branchName: string | null;
}

export interface WorkspaceRecord {
  id: Id;
  projectId: Id | null;
  kind: WorkspaceKind;
  path: string;
  state: WorkspaceState;
  createdAt: string;
  tombstonedAt: string | null;
  repository: {
    id: Id;
    stableIdentity: string;
    canonicalRemote: string | null;
    baseRef: string | null;
    headRef: string | null;
    branchName: string | null;
    integrationTargetRef: string | null;
  } | null;
}

export interface WorkspaceMutationResult {
  workspace: WorkspaceRecord;
  before: WorkspaceGitSnapshot | null;
  after: WorkspaceGitSnapshot | null;
}
