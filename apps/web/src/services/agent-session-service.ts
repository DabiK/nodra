import { api } from "../api";
import type { AgentSessionView } from "../types";

export async function startMissionSession(missionId: string, expectedVersion?: number, message?: string) {
  return api<{ runId: string; conversationId: string; threadId: string }>(`/api/agent-sessions/missions/${missionId}/start`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion, ...(message?.trim() ? { message: message.trim() } : {}) })
  });
}

export async function loadAgentSession(threadId: string) {
  return api<AgentSessionView>(`/api/agent-sessions/${threadId}`);
}

export async function steerRun(runId: string, text: string) {
  return api(`/api/runs/${runId}/steer`, {
    method: "POST",
    body: JSON.stringify({ text })
  });
}

export async function forceStopRun(runId: string) {
  return api<{ runId: string; state: string; runState: string; missionState: string | null }>(`/api/runs/${runId}/force-stop`, {
    method: "POST",
    body: "{}"
  });
}
