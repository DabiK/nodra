const KEY_PREFIX = "nodra.mission.notes.";

function key(missionId: string): string {
  return `${KEY_PREFIX}${missionId}`;
}

export function loadMissionNotes(missionId: string): string {
  try {
    return localStorage.getItem(key(missionId)) ?? "";
  } catch {
    return "";
  }
}

export function saveMissionNotes(missionId: string, notes: string): void {
  try {
    if (notes.trim()) localStorage.setItem(key(missionId), notes);
    else localStorage.removeItem(key(missionId));
  } catch {
    /* ignore storage failures (quota / private mode) */
  }
}

export function hasMissionNotes(missionId: string): boolean {
  return loadMissionNotes(missionId).trim().length > 0;
}

/**
 * Returns the ids of the missions whose notes contain `query`
 * (case-insensitive substring match). Scans the localStorage entries
 * written by this service, so it stays in sync with `saveMissionNotes`.
 */
export function searchMissionNotes(query: string): Set<string> {
  const normalized = query.trim().toLowerCase();
  const matches = new Set<string>();
  if (!normalized) return matches;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(KEY_PREFIX)) continue;
      const value = localStorage.getItem(key) ?? "";
      if (value.toLowerCase().includes(normalized)) matches.add(key.slice(KEY_PREFIX.length));
    }
  } catch {
    /* ignore storage failures (quota / private mode) */
  }
  return matches;
}
