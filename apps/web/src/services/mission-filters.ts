import type { MissionView } from "../types";

export interface MissionFilters {
  query: string;
  state: string;
  kind: string;
  sort: string;
}

export function filterMissions(missions: MissionView[], filters: MissionFilters) {
  const normalized = filters.query.trim().toLowerCase();
  return missions
    .filter((mission) => !normalized || mission.title.toLowerCase().includes(normalized) || mission.id.toLowerCase().includes(normalized))
    .filter((mission) => filters.state === "all" || mission.state === filters.state)
    .filter((mission) => filters.kind === "all" || mission.executionKind === filters.kind)
    .sort((left, right) => {
      if (filters.sort === "title") return left.title.localeCompare(right.title, "fr");
      if (filters.sort === "state") return left.state.localeCompare(right.state, "fr");
      return right.updatedAt.localeCompare(left.updatedAt);
    });
}
