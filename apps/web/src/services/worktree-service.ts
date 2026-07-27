import { api } from "../api";
import type { WorkspaceRecord } from "../types";

export interface WorktreeStatusView {
  mainRepositoryPath: string | null;
  worktreeExists: boolean;
  branchExists: boolean;
  branchName: string | null;
  baseRef: string | null;
  hasUncommittedChanges: boolean;
  hasUnmergedCommits: boolean;
  head: string | null;
}

export interface WorktreeResolutionResultView {
  status: WorktreeStatusView;
  action: "remove-all" | "keep-branch";
  worktreeRemoved: boolean;
  branchDeleted: boolean;
  branchKept: boolean;
  branchName: string | null;
}

export async function showWorkspace(workspaceId: string) {
  return api<WorkspaceRecord>(`/api/workspaces/${workspaceId}`);
}

export async function loadWorktreeStatus(workspaceId: string) {
  return api<WorktreeStatusView>(`/api/workspaces/${workspaceId}/worktree`);
}

export async function resolveWorktree(workspaceId: string, body: {
  action: "remove-all" | "keep-branch";
  confirmDiscardChanges?: boolean;
  confirmDeleteUnmerged?: boolean;
}) {
  return api<WorktreeResolutionResultView>(`/api/workspaces/${workspaceId}/worktree/resolve`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}
