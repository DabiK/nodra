import { api } from "../api";
import type { CreateWorkspaceInput, FolderBrowseResult, MissionIntakeDraft, WorkspaceRecord } from "../types";

const managedWorkspaceRoot = "/Users/Dabi/Documents/devflow/devflow-next/data/local/workspaces";

export async function browseFolders(path?: string) {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  return api<FolderBrowseResult>(`/api/folders${params.size ? `?${params}` : ""}`);
}

export async function createWorkspaceForMission(draft: MissionIntakeDraft) {
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
  return name.trim() ? `${managedWorkspaceRoot}/${slugify(name)}` : "";
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
