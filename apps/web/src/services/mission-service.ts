import { api } from "../api";
import type { AgentConfigView, MissionInspectorData, MissionIntakeDraft, MissionView, ProviderOptionsCatalog } from "../types";
import { createWorkspaceForMission } from "./workspace-service";

export async function listMissions() {
  return api<MissionView[]>("/api/missions");
}

export async function createHumanMission(input: { title: string; projectId?: string | null }) {
  const created = await api<MissionView>("/api/missions", {
    method: "POST",
    body: JSON.stringify({ title: input.title, projectId: input.projectId || null })
  });
  // Human missions are immediately actionable: promote DRAFT → READY on creation.
  try {
    return await api<MissionView>(`/api/missions/${created.id}/ready`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion: created.version })
    });
  } catch {
    return created;
  }
}

export async function showMission(missionId: string) {
  return api<MissionView>(`/api/missions/${missionId}`);
}

export async function getAgentConfig(missionId: string) {
  return api<AgentConfigView>(`/api/missions/${missionId}/agent-config`);
}

export async function loadMissionInspector(missionId: string): Promise<MissionInspectorData> {
  const mission = await showMission(missionId);
  const config = mission.executionKind === "agent"
    ? await getAgentConfig(missionId).catch(() => null)
    : null;
  return { mission, config };
}

export async function updateAgentConfig(input: {
  missionId: string;
  config: AgentConfigView;
  values: {
    providerId: string;
    modelId: string;
    reasoningEffort: AgentConfigView["reasoningEffort"];
    missionPrompt: string;
    permissionPreset: NonNullable<AgentConfigView["permissionPreset"]>;
    workspaceId: string;
    autoCommitAuthorized: boolean;
    integrationTargetRef: string | null;
  };
}) {
  return api<AgentConfigView>(`/api/missions/${input.missionId}/agent-config`, {
    method: "PUT",
    body: JSON.stringify({
      expectedVersion: input.config.version,
      providerId: input.values.providerId,
      modelId: input.values.modelId,
      reasoningEffort: input.values.reasoningEffort ?? "provider_default",
      providerOptions: input.config.providerOptions,
      missionPrompt: input.values.missionPrompt,
      permissionPreset: input.values.permissionPreset,
      workspaceId: input.values.workspaceId,
      autoCommitAuthorized: input.values.autoCommitAuthorized,
      integrationTargetRef: input.values.integrationTargetRef
    })
  });
}

export async function createConfiguredMission(draft: MissionIntakeDraft, catalog: ProviderOptionsCatalog) {
  const workspace = await createWorkspaceForMission(draft);
  const mission = await api<MissionView>("/api/missions", {
    method: "POST",
    body: JSON.stringify({ title: draft.title, projectId: draft.projectId || null })
  });

  const config = await api<AgentConfigView>(`/api/missions/${mission.id}/agent-config/enable`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion: mission.version })
  });

  await api(`/api/missions/${mission.id}/agent-config`, {
    method: "PUT",
    body: JSON.stringify({
      expectedVersion: config.version,
      providerId: draft.providerId,
      modelId: draft.modelId,
      reasoningEffort: draft.reasoningEffort,
      providerOptions: catalog.defaults.providerOptions,
      missionPrompt: draft.prompt || `Traite la mission « ${draft.title} » de bout en bout.`,
      permissionPreset: draft.permissionPreset,
      workspaceId: workspace.id,
      autoCommitAuthorized: false,
      integrationTargetRef: null
    })
  });

  return mission;
}
