import { api } from "../api";
import type { AgentConfigView, MissionInspectorData, MissionIntakeDraft, MissionRunsView, MissionView, ProviderOptionsCatalog } from "../types";
import { createWorkspace, createWorkspaceForMission, workspacePathFromName } from "./workspace-service";
import { loadMissionProviderSession } from "./mission-provider-session-service";

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
  if (missionId.includes("/")) {
    return api<MissionView>(`/api/missions/lookup?missionId=${encodeURIComponent(missionId)}`);
  }
  return api<MissionView>(`/api/missions/${missionId}`);
}

export async function getAgentConfig(missionId: string) {
  return api<AgentConfigView>(`/api/missions/${missionId}/agent-config`);
}

export async function loadMissionInspector(missionId: string): Promise<MissionInspectorData> {
  const mission = await showMission(missionId);
  const [config, providerSession] = mission.executionKind === "agent"
    ? await Promise.all([
      getAgentConfig(missionId).catch(() => null),
      loadMissionProviderSession(missionId).catch(() => null)
    ])
    : [null, null];
  return { mission, config, providerSession };
}

/** Historique des runs d'une mission avec usage et coût, + total cumulé. */
export async function loadMissionRuns(missionId: string): Promise<MissionRunsView> {
  return api<MissionRunsView>(`/api/missions/${missionId}/runs`);
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

export interface DuplicateMissionInput {
  title: string;
  projectId: string | null;
  /** Configuration agent de la mission source (mêmes réglages, même workspace). */
  source: AgentConfigView;
  /** Modèle choisi au relancement (par défaut celui de la source). */
  modelId: string;
}

/**
 * Duplique une mission avec les mêmes réglages : config agent + prompt +
 * workspace, puis la place directement en READY (issue #16).
 *
 * Le workspace n'est pas recréé : la copie référence le même workspace que la
 * mission source (dédup serveur par chemin si besoin). S'il n'y en a pas, un
 * workspace scratch est créé.
 */
export async function duplicateMission(input: DuplicateMissionInput) {
  const created = await api<MissionView>("/api/missions", {
    method: "POST",
    body: JSON.stringify({ title: input.title, projectId: input.projectId || null })
  });

  let workspaceId = input.source.workspaceId;
  if (!workspaceId) {
    const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "workspace";
    const workspace = await createWorkspace({ kind: "scratch", path: workspacePathFromName(slug) });
    workspaceId = workspace.id;
  }

  const enabled = await api<AgentConfigView>(`/api/missions/${created.id}/agent-config/enable`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion: created.version })
  });

  await api(`/api/missions/${created.id}/agent-config`, {
    method: "PUT",
    body: JSON.stringify({
      expectedVersion: enabled.version,
      providerId: input.source.providerId ?? "opencode",
      modelId: input.modelId,
      reasoningEffort: input.source.reasoningEffort ?? "provider_default",
      providerOptions: input.source.providerOptions,
      missionPrompt: input.source.missionPrompt.trim()
        || `Traite la mission « ${input.title} » de bout en bout.`,
      permissionPreset: input.source.permissionPreset ?? "workspace",
      workspaceId,
      autoCommitAuthorized: input.source.autoCommitAuthorized,
      integrationTargetRef: input.source.integrationTargetRef
    })
  });

  // Statut READY : la copie apparaît immédiatement dans le board, prête à lancer.
  // La mission source a été créée en version 0 puis incrémentée par l'enable — la
  // copie est donc en version `created.version + 1` à ce stade (l'update de config
  // n'incrémente que la version de la config, pas celle de la mission).
  return api<MissionView>(`/api/missions/${created.id}/ready`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion: created.version + 1 })
  });
}
