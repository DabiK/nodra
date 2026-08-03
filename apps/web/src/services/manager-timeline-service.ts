import { api } from "../api";
import type { ManagerTimelineItemKind, ManagerTimelineView } from "../types";

export interface ManagerTimelineFilterInput {
  managerId?: string | null;
  /** Messages dont le corps mentionne cet identifiant de mission. */
  missionId?: string | null;
  query?: string | null;
  since?: string | null;
  until?: string | null;
  limit?: number;
}

export function buildTimelineQuery(filter: ManagerTimelineFilterInput): string {
  const params = new URLSearchParams();
  if (filter.managerId) params.set("managerId", filter.managerId);
  if (filter.missionId) params.set("missionId", filter.missionId);
  if (filter.query) params.set("query", filter.query);
  if (filter.since) params.set("since", filter.since);
  if (filter.until) params.set("until", filter.until);
  if (filter.limit !== undefined) params.set("limit", String(filter.limit));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function loadManagerTimeline(filter: ManagerTimelineFilterInput = {}): Promise<ManagerTimelineView> {
  return api<ManagerTimelineView>(`/api/managers/timeline${buildTimelineQuery(filter)}`);
}

export const TIMELINE_PERIODS = [
  { value: "", label: "Tout" },
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 jours" },
  { value: "30d", label: "30 jours" }
] as const;

export type TimelinePeriod = (typeof TIMELINE_PERIODS)[number]["value"];

/** Borne `since` (ISO) pour une période donnée, ou null quand « Tout ». */
export function timelineSince(period: TimelinePeriod): string | null {
  const hours = period === "24h" ? 24 : period === "7d" ? 168 : period === "30d" ? 720 : 0;
  if (!hours) return null;
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

export const TIMELINE_KIND_LABELS: Record<ManagerTimelineItemKind, string> = {
  user: "Brief",
  assistant: "Réponse",
  tool: "Outil",
  system: "Système",
  steer: "Indication",
  result: "Résultat"
};
