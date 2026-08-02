import { api } from "../api";
import type {
  MissionProviderSessionCapabilitiesView,
  ProviderSessionDetailView,
  ProviderSessionTurnCommandResult
} from "../types";

function missionPath(missionId: string) {
  return `/api/missions/${encodeURIComponent(missionId)}/provider-session`;
}

export function loadMissionProviderSession(missionId: string) {
  return api<ProviderSessionDetailView>(missionPath(missionId));
}

export function loadMissionProviderSessionCapabilities(missionId: string) {
  return api<MissionProviderSessionCapabilitiesView>(`${missionPath(missionId)}/capabilities`);
}

export function activateMissionProviderSession(missionId: string, expectedVersion: number, commandId: string) {
  return api(`${missionPath(missionId)}/activate`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion, commandId })
  });
}

export function ensureMissionObservationSession(missionId: string, commandId: string) {
  return api<ProviderSessionDetailView>(`${missionPath(missionId)}/ensure-observation`, {
    method: "POST",
    body: JSON.stringify({ commandId })
  });
}

export function startMissionProviderTurn(missionId: string, text: string, commandId: string) {
  return api<ProviderSessionTurnCommandResult>(`${missionPath(missionId)}/turns`, {
    method: "POST",
    body: JSON.stringify({ text, commandId })
  });
}

export function steerMissionProviderTurn(missionId: string, externalTurnId: string, text: string, commandId: string) {
  return api<ProviderSessionTurnCommandResult>(`${missionPath(missionId)}/steer`, {
    method: "POST",
    body: JSON.stringify({ externalTurnId, text, commandId })
  });
}
