export type MissionViewMode = "board" | "list";

const KEY = "nodra.tasks.view";

/** Read the persisted view mode of the tasks page (default: kanban board). */
export function loadViewMode(): MissionViewMode {
  try {
    return localStorage.getItem(KEY) === "list" ? "list" : "board";
  } catch {
    return "board";
  }
}

/** Persist the view mode so it survives navigation and reloads. */
export function saveViewMode(mode: MissionViewMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* ignore storage failures (quota / private mode) */
  }
}
