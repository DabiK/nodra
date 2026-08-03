import type { MissionState, MissionView } from "../types";
import { searchMissionNotes } from "./mission-notes-service";
import { isMissionToday, sortByUrgency } from "./mission-day-service";
import type { MissionSchedule } from "./mission-schedule-service";

export interface MissionFilters {
  query: string;
  state: string;
  kind: string;
  sort: string;
  /** Filtre « Ma journée » (#17) : "all" ou "today". */
  day: string;
  /** Filtre par tags libres (#23) : ids de tags — vide = aucun filtre. */
  tags: string[];
}

/** French labels used by the full-text search so "en cours" matches ACTIVE. */
export const MISSION_STATE_LABELS: Record<MissionState, string> = {
  DRAFT: "brouillon",
  BACKLOG: "backlog",
  READY: "prête prette",
  ACTIVE: "en cours active",
  BLOCKED: "bloquée bloquee",
  VALIDATION: "en validation validation",
  DONE: "terminée terminee faite done",
  ABANDONED: "abandonnée abandonnee"
};

export function filterMissions(missions: MissionView[], filters: MissionFilters, schedule?: MissionSchedule) {
  const normalized = filters.query.trim().toLowerCase();
  const noteMatches = searchMissionNotes(filters.query);
  const filtered = missions
    .filter((mission) => !normalized || matchesQuery(mission, normalized, noteMatches))
    .filter((mission) => filters.state === "all" || mission.state === filters.state)
    .filter((mission) => filters.kind === "all" || mission.executionKind === filters.kind)
    // Filtre par tags (#23) : la mission doit porter au moins un tag sélectionné.
    .filter((mission) => filters.tags.length === 0 || (mission.tagIds ?? []).some((tagId) => filters.tags.includes(tagId)));

  // « Ma journée » : seules les missions planifiées ou touchées aujourd'hui,
  // triées par urgence (retard > validation en attente > active > nouveau).
  if (filters.day === "today" && schedule) {
    return sortByUrgency(filtered.filter((mission) => isMissionToday(mission, schedule)), schedule);
  }
  return [...filtered].sort((left, right) => {
    if (filters.sort === "title") return left.title.localeCompare(right.title, "fr");
    if (filters.sort === "state") return left.state.localeCompare(right.state, "fr");
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function matchesQuery(mission: MissionView, normalized: string, noteMatches: Set<string>): boolean {
  if (mission.title.toLowerCase().includes(normalized)) return true;
  if (mission.id.toLowerCase().includes(normalized)) return true;
  if (mission.state.toLowerCase().includes(normalized)) return true;
  if (MISSION_STATE_LABELS[mission.state].includes(normalized)) return true;
  if (mission.executionKind === "agent" && normalized.includes("agent")) return true;
  if (mission.executionKind === "human" && (normalized.includes("humain") || normalized.includes("human"))) return true;
  return noteMatches.has(mission.id);
}
