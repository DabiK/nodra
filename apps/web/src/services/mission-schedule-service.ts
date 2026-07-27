const KEY = "nodra.mission.schedule";

export type MissionSchedule = Record<string, string>;

/** Local calendar day (YYYY-MM-DD) for a given date/ISO string. */
export function dayKey(value: string | Date = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return todayKey();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function loadSchedule(): MissionSchedule {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as MissionSchedule : {};
  } catch {
    return {};
  }
}

function persist(schedule: MissionSchedule): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(schedule));
  } catch {
    /* ignore storage failures (quota / private mode) */
  }
}

/** Scheduled day for a mission, defaulting to its creation day. */
export function scheduledDay(schedule: MissionSchedule, missionId: string, createdAt: string): string {
  return schedule[missionId] ?? dayKey(createdAt);
}

/** Move the given missions to today; returns the updated schedule. */
export function rescheduleToday(schedule: MissionSchedule, missionIds: readonly string[]): MissionSchedule {
  const today = todayKey();
  const next: MissionSchedule = { ...schedule };
  for (const id of missionIds) next[id] = today;
  persist(next);
  return next;
}
