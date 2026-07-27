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
