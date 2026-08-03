import type { MissionState, MissionView } from "../types";
import type { SidebarMission } from "../components/AppSidebar";

const byUpdatedAtDesc = (a: MissionView, b: MissionView) => b.updatedAt.localeCompare(a.updatedAt);

/**
 * Selects the missions shown in the sidebar "Missions actives" section.
 * Sans recherche : seules les missions en cours (state ACTIVE) sont listées,
 * les plus récemment mises à jour en premier. Avec une recherche non vide :
 * toutes les missions dont le titre correspond, quel que soit leur état.
 */
export function selectActiveSidebarMissions(missions: MissionView[], query?: string): SidebarMission[] {
  const needle = query?.trim().toLowerCase();
  return missions
    .filter((mission) => (needle
      ? mission.title.toLowerCase().includes(needle)
      : mission.state === "ACTIVE"))
    .sort(byUpdatedAtDesc)
    .map((mission) => ({ id: mission.id, title: mission.title, state: mission.state }));
}
