import type { MissionFilters } from "./mission-filters";

const KEY = "nodra.tasks.filters";

const DEFAULTS: MissionFilters = { query: "", state: "all", kind: "all", sort: "recent", day: "all" };

/**
 * Restores the last used mission board filters (query + state + kind + sort
 * + day) so the board reopens in the same configuration across reloads.
 */
export function loadSavedMissionFilters(): MissionFilters {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<MissionFilters>;
    return {
      query: typeof parsed.query === "string" ? parsed.query : DEFAULTS.query,
      state: typeof parsed.state === "string" ? parsed.state : DEFAULTS.state,
      kind: typeof parsed.kind === "string" ? parsed.kind : DEFAULTS.kind,
      sort: typeof parsed.sort === "string" ? parsed.sort : DEFAULTS.sort,
      day: typeof parsed.day === "string" ? parsed.day : DEFAULTS.day
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Persists the current board filters so they survive navigation and reloads. */
export function saveMissionFilters(filters: MissionFilters): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(filters));
  } catch {
    /* ignore storage failures (quota / private mode) */
  }
}
