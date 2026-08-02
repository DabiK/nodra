import { api } from "../api";
import type { MissionView } from "../types";
import type { MissionActionId } from "./mission-ui-policy";
import { startMissionSession } from "./agent-session-service";
import { activateMissionProviderSession } from "./mission-provider-session-service";

export interface MissionActionInput {
  actionId: MissionActionId;
  mission: MissionView;
  latestRunId: string | null;
  comment?: string;
}

export async function performMissionAction(input: MissionActionInput) {
  const { actionId, mission, latestRunId } = input;
  if (actionId === "start") {
    await startMissionSession(mission.id, mission.version);
    location.assign(`/agent.html?missionId=${encodeURIComponent(mission.id)}`);
    return;
  }
  if (actionId === "open-provider-session") {
    if (mission.state === "READY") {
      await activateMissionProviderSession(mission.id, mission.version, crypto.randomUUID());
    }
    location.assign(`/agent.html?missionId=${encodeURIComponent(mission.id)}`);
    return;
  }
  if (actionId === "accept-result") return decideDelivery(latestRunId, "accept", mission.version, input.comment ?? "Résultat accepté");
  if (actionId === "request-changes") return decideDelivery(latestRunId, "request-changes", mission.version, input.comment ?? "Corrections demandées");
  if (actionId === "reject-result") return decideDelivery(latestRunId, "reject", mission.version, input.comment ?? "Résultat rejeté");
  if (actionId === "validate") return transition(mission, "accept");
  if (actionId === "resume") return transition(mission, "unblock");
  if (actionId === "abandon") return transition(mission, "abandon");
  if (actionId === "mark-ready") return transition(mission, "ready");
  if (actionId === "pickup") return transition(mission, "pickup");
  if (actionId === "complete-human") return transition(mission, "complete");
}

async function transition(mission: MissionView, route: "ready" | "pickup" | "unblock" | "complete" | "abandon" | "accept") {
  return api<MissionView>(`/api/missions/${mission.id}/${route}`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion: mission.version })
  });
}

async function decideDelivery(runId: string | null, decision: "accept" | "request-changes" | "reject", expectedMissionVersion: number, comment: string) {
  if (!runId) throw new Error("Aucun run disponible pour décider le résultat.");
  return api(`/api/runs/${runId}/delivery/${decision}`, {
    method: "POST",
    body: JSON.stringify({ expectedMissionVersion, comment })
  });
}
