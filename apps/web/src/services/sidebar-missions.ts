import type { MissionState, MissionView } from "../types";
import type { SidebarMission } from "../components/AppSidebar";

const byUpdatedAtDesc = (a: MissionView, b: MissionView) => b.updatedAt.localeCompare(a.updatedAt);

/**
 * Selects the missions shown in the sidebar "Missions actives" section.
 * Only the missions currently running (state ACTIVE) are shown, most
 * recently updated first. DONE and ABANDONED missions are excluded.
 */
export function selectActiveSidebarMissions(missions: MissionView[]): SidebarMission[] {
  return missions
    .filter((mission) => mission.state === "ACTIVE")
    .sort(byUpdatedAtDesc)
    .map((mission) => ({ id: mission.id, title: mission.title, state: mission.state }));
}
