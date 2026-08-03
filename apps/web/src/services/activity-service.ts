import { api } from "../api";

export type ActivityQueue = "blocked" | "decision_required";

export interface ActivityMissionSubject {
  kind: "mission";
  mission: {
    id: string;
    title: string;
    executionKind: "human" | "agent";
    state: string;
    updatedAt: string;
  };
}

export interface ActivityPipelineSubject {
  kind: "pipeline";
  pipelineId: string;
  pipelineName: string;
}

export type ActivitySubject = ActivityMissionSubject | ActivityPipelineSubject;

export interface ActivityItem {
  relayId: string;
  queue: ActivityQueue;
  state: "unread" | "read" | "snoozed";
  reasonCode: string;
  createdAt: string;
  readAt: string | null;
  subject: ActivitySubject;
}

export interface ActivityView {
  items: ActivityItem[];
  unreadCount: number;
}

/** Charge les items du hub d'activité (missions à décision humaine, pipelines bloqués). */
export async function loadActivity() {
  return api<ActivityView>("/api/activity");
}

/** Marque un item du hub comme lu (le badge et la liste sont rafraîchis par le SSE). */
export async function markActivityRead(relayId: string) {
  return api<{ ok: true }>(`/api/activity/${encodeURIComponent(relayId)}/read`, { method: "POST" });
}
