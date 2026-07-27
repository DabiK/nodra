import { api } from "../api";
import type { CreateWorkspaceInput, FolderBrowseResult, MissionIntakeDraft, WorkspaceRecord } from "../types";
import { serverConfig } from "./config-service";
import { branchNameFromTitle } from "./workspace-mode";

// Fallback used only until the server config (which reports the real, OS-correct
// workspaces root) has been fetched. Kept relative so it is never a wrong
// absolute path baked into the client.
const fallbackWorkspaceRoot = "data/local/workspaces";

export async function browseFolders(path?: string) {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  return api<FolderBrowseResult>(`/api/folders${params.size ? `?${params}` : ""}`);
}

export async function createWorkspaceForMission(draft: MissionIntakeDraft) {
  // A git worktree is created ONLY when the user explicitly selects that mode.
  // Any other mode goes through the repo/scratch path — never git worktree add.
  if (draft.workspaceKind === "worktree") {
    if (!draft.sourceWorkspaceId.trim() && !draft.sourceRepositoryPath.trim()) {
      throw new Error("Choisis un dépôt Git source pour créer un worktree.");
    }
    const fallbackTitle = draft.workspaceName.trim() || draft.projectId.trim() || draft.title.trim();
    return createWorkspace({
      kind: "worktree",
      ...(draft.workspacePath.trim() ? { path: draft.workspacePath.trim() } : {}),
      ...(draft.sourceWorkspaceId.trim()
        ? { sourceWorkspaceId: draft.sourceWorkspaceId.trim() }
        : { sourceRepositoryPath: draft.sourceRepositoryPath.trim() }),
      baseRef: draft.baseRef.trim() || "HEAD",
      branchName: draft.branchName.trim() || branchNameFromTitle(fallbackTitle),
      ...(draft.projectId.trim() ? { projectId: draft.projectId.trim() } : {})
    });
  }
  const path = workspacePathForDraft(draft);
  return createWorkspace({
    kind: draft.workspaceKind,
    ...(path ? { path } : {}),
    ...(draft.projectId.trim() ? { projectId: draft.projectId.trim() } : {})
  });
}

export async function createWorkspace(input: CreateWorkspaceInput) {
  return api<WorkspaceRecord>("/api/workspaces", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function workspacePathForDraft(draft: MissionIntakeDraft) {
  if (draft.workspaceKind === "repo") return draft.workspacePath.trim();
  const name = draft.workspaceName.trim() || draft.projectId.trim() || draft.title.trim();
  return workspacePathFromName(name);
}

export function workspacePathFromName(name: string) {
  const root = serverConfig()?.workspacesRoot ?? fallbackWorkspaceRoot;
  return name.trim() ? `${root}/${slugify(name)}` : "";
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "workspace";
}
