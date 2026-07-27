const KEY = "nodra.sidebar.collapsed";

/** Read the persisted collapsed state of the left sidebar (default: expanded). */
export function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the collapsed state so it survives navigation and reloads. */
export function saveSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore storage failures (quota / private mode) */
  }
}

/**
 * Class name for the app shell. When collapsed, the main area automatically
 * reclaims the freed grid column (see `.app-shell.sidebar-collapsed` CSS).
 */
export function appShellClassName(collapsed: boolean): string {
  return collapsed ? "app-shell sidebar-collapsed" : "app-shell";
}
