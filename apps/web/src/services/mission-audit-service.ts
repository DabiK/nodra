import { api } from "../api";

/** Événement d'audit d'une mission (timeline, GET /api/missions/:id/audit). */
export interface MissionAuditView {
  id: string;
  commandId: string;
  eventType: string;
  actor: "user" | "manager";
  payload: Readonly<Record<string, unknown>>;
  occurredAt: string;
}

/** Timeline d'audit de la mission, du plus ancien au plus récent. */
export async function loadMissionAudit(missionId: string): Promise<MissionAuditView[]> {
  return api<MissionAuditView[]>(`/api/missions/${missionId}/audit`);
}
