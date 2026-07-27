import { api } from "../api";
import type { AgentSessionView } from "../types";
import { loadAgentSession } from "./agent-session-service";

export interface DeliveryView {
  id: string;
  runId: string;
  agentDeclaration: string;
  observationSummary: string | null;
  resultState: "delivered" | "accepted" | "changes_requested" | "rejected";
  acceptedAt: string | null;
  decisionComment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MissionResultView {
  latestRunId: string | null;
  latestRunState: string | null;
  delivery: DeliveryView | null;
  assistantMessage: string | null;
  hasStructuredDelivery: boolean;
}

export async function loadMissionResult(missionId: string): Promise<MissionResultView> {
  const latest = await latestRunForMission(missionId);
  if (!latest) return emptyResult();
  const [session, delivery] = await Promise.all([
    loadAgentSession(latest.runId).catch(() => null),
    loadRunDelivery(latest.runId).catch(() => null)
  ]);
  return {
    latestRunId: latest.runId,
    latestRunState: session?.run.state ?? null,
    delivery,
    assistantMessage: delivery?.agentDeclaration || lastAssistantMessage(session),
    hasStructuredDelivery: Boolean(delivery)
  };
}

export async function latestRunForMission(missionId: string) {
  try {
    return await api<{ runId: string; threadId: string }>(`/api/agent-sessions/missions/${missionId}/latest`);
  } catch {
    return null;
  }
}

export async function loadRunDelivery(runId: string) {
  return api<DeliveryView>(`/api/runs/${runId}/delivery`);
}

function emptyResult(): MissionResultView {
  return {
    latestRunId: null,
    latestRunState: null,
    delivery: null,
    assistantMessage: null,
    hasStructuredDelivery: false
  };
}

function lastAssistantMessage(session: AgentSessionView | null) {
  const itemMessage = [...(session?.items ?? [])]
    .reverse()
    .find((item) => item.kind === "assistant" && item.body?.trim())?.body;
  if (itemMessage) return itemMessage;
  for (const event of [...(session?.events ?? [])].reverse()) {
    const text = assistantTextFromPayload(event.type, event.payload);
    if (text) return text;
  }
  return null;
}

function assistantTextFromPayload(type: string, payload: unknown) {
  if (!type.includes("assistant") && !type.includes("message")) return null;
  const record = payloadRecord(payload);
  const item = payloadRecord(record?.item);
  const properties = payloadRecord(record?.properties);
  const part = payloadRecord(properties?.part);
  if (typeof item?.text === "string" && item.text.trim()) return item.text;
  if (typeof part?.text === "string" && part.text.trim()) return part.text;
  if (typeof record?.text === "string" && record.text.trim()) return record.text;
  return null;
}

function payloadRecord(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
}
