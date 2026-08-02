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

/** Live Git status of a worktree, used to drive safe end-of-task resolution. */
export interface WorktreeStatus {
  /** Absolute path of the main repository, resolved from the worktree. Null if it can't be determined (e.g. the worktree directory was deleted manually). */
  mainRepositoryPath: string | null;
  /** The worktree directory exists on disk AND is registered in Git. */
  worktreeExists: boolean;
  /** The task branch still exists in the main repository. */
  branchExists: boolean;
  branchName: string | null;
  baseRef: string | null;
  /** Uncommitted (staged, unstaged or untracked) changes are present. */
  hasUncommittedChanges: boolean;
  /** The branch has commits that are not reachable from its base ref. */
  hasUnmergedCommits: boolean;
  head: string | null;
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

export type WorkspaceDiffFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface WorkspaceDiffFile {
  path: string;
  oldPath: string | null;
  status: WorkspaceDiffFileStatus;
  /** Lignes ajoutées/supprimées (null pour les fichiers binaires). */
  additions: number | null;
  deletions: number | null;
  /** Diff unifié texte pour ce fichier (peut être tronqué pour les très gros fichiers). */
  content: string;
}

export interface WorkspaceDiff {
  /** Ref comparée comme base (null si aucun HEAD n'a pu être résolu). */
  base: string | null;
  /** Ref comparée comme tête — null signifie l'arbre de travail (working tree). */
  head: string | null;
  files: WorkspaceDiffFile[];
}
