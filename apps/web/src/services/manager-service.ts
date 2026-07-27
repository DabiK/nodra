import { api } from "../api";
import type {
  ManagerConversationView,
  ManagerThreadView,
  ManagerView,
  ProviderPermissionPreset,
  ProviderReasoningEffort
} from "../types";
import { createWorkspace } from "./workspace-service";

export interface ManagerConfigInput {
  name?: string;
  instruction?: string;
  providerId?: string;
  modelId?: string;
  reasoningEffort?: ProviderReasoningEffort;
  permissionPreset?: ProviderPermissionPreset;
  workspaceId?: string;
}

export interface CreateManagerInput extends ManagerConfigInput {
  name: string;
  instruction: string;
  workspacePath?: string;
}

export async function listManagers() {
  return api<ManagerView[]>("/api/managers");
}

export async function showManager(id: string) {
  return api<ManagerView>(`/api/managers/${id}`);
}

export async function createManager(input: CreateManagerInput) {
  let workspaceId = input.workspaceId;
  if (!workspaceId && input.workspacePath?.trim()) {
    const workspace = await createWorkspace({ kind: "repo", path: input.workspacePath.trim() });
    workspaceId = workspace.id;
  }
  return api<ManagerView>("/api/managers", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      instruction: input.instruction,
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.modelId ? { modelId: input.modelId } : {}),
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
      ...(input.permissionPreset ? { permissionPreset: input.permissionPreset } : {}),
      ...(workspaceId ? { workspaceId } : {})
    })
  });
}

export async function updateManager(id: string, input: ManagerConfigInput & { workspacePath?: string }) {
  let { workspaceId } = input;
  if (!workspaceId && input.workspacePath?.trim()) {
    const workspace = await createWorkspace({ kind: "repo", path: input.workspacePath.trim() });
    workspaceId = workspace.id;
  }
  return api<ManagerView>(`/api/managers/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.instruction !== undefined ? { instruction: input.instruction } : {}),
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.modelId ? { modelId: input.modelId } : {}),
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
      ...(input.permissionPreset ? { permissionPreset: input.permissionPreset } : {}),
      ...(workspaceId ? { workspaceId } : {})
    })
  });
}

export async function archiveManager(id: string) {
  return api(`/api/managers/${id}`, { method: "DELETE" });
}

export async function listManagerConversations(id: string) {
  return api<ManagerConversationView[]>(`/api/managers/${id}/conversations`);
}

export async function loadManagerThread(id: string, threadId: string) {
  return api<ManagerThreadView>(`/api/managers/${id}/threads/${threadId}`);
}

export async function latestManagerThread(id: string) {
  return api<{ threadId: string | null }>(`/api/managers/${id}/threads`);
}

export async function sendManagerMessage(
  id: string,
  input: { message: string; threadId?: string | null; newConversation?: boolean }
) {
  return api<{ runId: string; threadId: string | null; steered: boolean }>(`/api/managers/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      message: input.message,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.newConversation ? { newConversation: true } : {})
    })
  });
}

export async function stopManager(id: string) {
  return api<{ managerId: string; stopped: number }>(`/api/managers/${id}/stop`, {
    method: "POST",
    body: "{}"
  });
}

export async function deleteManagerThread(id: string, threadId: string) {
  return api<{ threadId: string; deleted: boolean }>(`/api/managers/${id}/threads/${threadId}`, {
    method: "DELETE"
  });
}
