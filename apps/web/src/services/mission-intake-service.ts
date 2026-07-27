import type { MissionIntakeDraft, ProviderOptionsCatalog } from "../types";
import { createConfiguredMission, createHumanMission, listMissions } from "./mission-service";
import { saveMissionNotes } from "./mission-notes-service";
import { loadProviderOptions, selectDefaultModel } from "./provider-service";

export async function loadMissionIntake() {
  const [missions, providerOptions] = await Promise.all([
    listMissions(),
    loadProviderOptions()
  ]);
  return { missions, providerOptions, draft: createInitialDraft(providerOptions) };
}

export function createInitialDraft(catalog: ProviderOptionsCatalog): MissionIntakeDraft {
  return {
    title: "",
    kind: "agent",
    prompt: "",
    notes: "",
    projectId: "",
    workspaceKind: "scratch",
    workspacePath: "",
    workspaceName: "",
    providerId: catalog.defaults.providerId,
    modelId: selectDefaultModel(catalog, catalog.defaults.providerId),
    reasoningEffort: catalog.defaults.reasoningEffort,
    permissionPreset: catalog.defaults.permissionPreset
  };
}

export async function submitMissionIntake(draft: MissionIntakeDraft, catalog: ProviderOptionsCatalog) {
  if (draft.kind === "human") {
    const mission = await createHumanMission({ title: draft.title, projectId: draft.projectId });
    saveMissionNotes(mission.id, draft.notes);
    return mission;
  }
  return createConfiguredMission(draft, catalog);
}
