import { api } from "../api";

/** Tag libre de mission (issue #23) : libellé + couleur #RRGGBB. */
export interface MissionTag {
  id: string;
  label: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

/** Palette de couleurs proposées à la création d'un tag. */
export const TAG_COLOR_PALETTE = [
  "#e5484d", // rouge
  "#f76b15", // orange
  "#f5a524", // ambre
  "#46a758", // vert
  "#12a594", // teal
  "#3e63dd", // bleu
  "#8e4ec6", // violet
  "#d6409f", // magenta
  "#6b7280", // gris
  "#5b8def"  // azur
] as const;

export async function loadTags(): Promise<MissionTag[]> {
  return api<MissionTag[]>("/api/tags");
}

export async function createTag(input: { label: string; color: string }): Promise<MissionTag> {
  return api<MissionTag>("/api/tags", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateTag(input: { id: string; label: string; color: string }): Promise<MissionTag> {
  return api<MissionTag>(`/api/tags/${encodeURIComponent(input.id)}`, {
    method: "PUT",
    body: JSON.stringify({ label: input.label, color: input.color })
  });
}

export async function deleteTag(tagId: string): Promise<void> {
  await api<{ ok: true }>(`/api/tags/${encodeURIComponent(tagId)}`, { method: "DELETE" });
}

/** Tags attachés à une mission, triés par libellé. */
export async function loadMissionTags(missionId: string): Promise<MissionTag[]> {
  return api<MissionTag[]>(`/api/missions/${encodeURIComponent(missionId)}/tags`);
}

/** Remplace l'ensemble des tags d'une mission ([] retire tous les tags). */
export async function setMissionTags(missionId: string, tagIds: string[]): Promise<void> {
  await api<{ ok: true }>(`/api/missions/${encodeURIComponent(missionId)}/tags`, {
    method: "PUT",
    body: JSON.stringify({ tagIds })
  });
}
