import type { MissionView } from "../types";
import { dayKey, scheduledDay, todayKey, type MissionSchedule } from "./mission-schedule-service";

/**
 * Filtre « Ma journée » (#17) : une mission concerne la journée quand
 * - elle est planifiée aujourd'hui (planning local `nodra.mission.schedule`,
 *   par défaut le jour de sa création), ou
 * - elle a été touchée aujourd'hui : créée, activée, validée, bloquée…
 *   `updatedAt` est posé à chaque transition d'état par le domaine
 *   (`transitionFrom`), c'est le proxy du « stateChangedAt » — aucun appel
 *   audit par mission, pas de N+1.
 */
export function isMissionToday(mission: MissionView, schedule: MissionSchedule): boolean {
  const today = todayKey();
  return scheduledDay(schedule, mission.id, mission.createdAt) === today
    || dayKey(mission.updatedAt) === today;
}

/**
 * Rang d'urgence pour le tri « Ma journée » : retard > validation en attente
 * > active > nouveau. Le retard suit la même règle que la bannière
 * « en retard » (planifié avant aujourd'hui et pas encore terminé).
 */
export function urgencyRank(mission: MissionView, schedule: MissionSchedule, today = todayKey()): number {
  if (scheduledDay(schedule, mission.id, mission.createdAt) < today
    && mission.state !== "DONE"
    && mission.state !== "ABANDONED") {
    return 0; // retard
  }
  if (mission.state === "VALIDATION") return 1; // validation en attente
  if (mission.state === "ACTIVE") return 2; // active
  return 3; // nouveau
}

/** Trie les missions par urgence ; les plus récentes d'abord à rang égal. */
export function sortByUrgency(missions: readonly MissionView[], schedule: MissionSchedule): MissionView[] {
  const today = todayKey();
  return [...missions].sort((left, right) => {
    const rank = urgencyRank(left, schedule, today) - urgencyRank(right, schedule, today);
    if (rank !== 0) return rank;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

/** Nombre de missions concernées par « Ma journée » (compteur du chip). */
export function countTodayMissions(missions: readonly MissionView[], schedule: MissionSchedule): number {
  return missions.filter((mission) => isMissionToday(mission, schedule)).length;
}
