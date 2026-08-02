import type { MissionAuditView } from "./mission-audit-service";
import { describeAuditEvent as describeBaseAuditEvent } from "./mission-export-service";

/**
 * Vue du panneau « Historique » d'une mission : catégorisation des événements
 * d'audit (filtres), libellés enrichis (décisions de delivery, état de gate)
 * et formatage des horodatages.
 */

/** Catégories de filtrage de la timeline d'audit. */
export type AuditCategory =
  | "transition"
  | "delivery"
  | "run"
  | "gate"
  | "config"
  | "provider"
  | "other";

/** Filtres proposés par le panneau (ordre d'affichage). */
export interface AuditFilter {
  key: "all" | AuditCategory;
  label: string;
}

export const AUDIT_FILTERS: AuditFilter[] = [
  { key: "all", label: "Tout" },
  { key: "transition", label: "Transitions" },
  { key: "delivery", label: "Delivery" },
  { key: "run", label: "Runs" },
  { key: "gate", label: "Gates" },
  { key: "config", label: "Config" },
  { key: "provider", label: "Provider" }
];

/** Types d'événements qui changent l'état de la mission (transitions). */
const TRANSITION_EVENT_TYPES = new Set([
  "MISSION_CREATED",
  "MISSION_PREPARED",
  "MISSION_PICKED_UP",
  "MISSION_BLOCKED",
  "MISSION_RESUMED",
  "MISSION_CORRECTION_REQUESTED",
  "MISSION_SUBMITTED_FOR_VALIDATION",
  "MISSION_ACCEPTED",
  "MISSION_CLOSED",
  "MISSION_ABANDONED"
]);

const DELIVERY_EVENT_TYPES = new Set(["DELIVERY_DECLARED", "DELIVERY_DECIDED"]);

const RUN_EVENT_TYPES = new Set([
  "RUN_TERMINAL_RECORDED",
  "RUN_TERMINAL_MISSION_TRANSITION_SKIPPED",
  "MISSION_START_REQUESTED",
  "EVIDENCE_RECORDED"
]);

const GATE_EVENT_TYPES = new Set(["GATE_DEFINED", "GATE_EVALUATED", "GATE_EVIDENCE_STALE"]);

const CONFIG_EVENT_TYPES = new Set(["MISSION_AGENT_ENABLED", "MISSION_AGENT_CONFIG_UPDATED"]);

const PROVIDER_EVENT_TYPES = new Set([
  "PROVIDER_SESSION_MISSION_ACTIVATED",
  "READY_AGENT_MISSION_CREATED_FROM_PROVIDER_SESSION"
]);

/** Catégorie d'un événement d'audit, dérivée de son type. */
export function auditEventCategory(eventType: string): AuditCategory {
  if (TRANSITION_EVENT_TYPES.has(eventType)) return "transition";
  if (DELIVERY_EVENT_TYPES.has(eventType)) return "delivery";
  if (RUN_EVENT_TYPES.has(eventType)) return "run";
  if (GATE_EVENT_TYPES.has(eventType)) return "gate";
  if (CONFIG_EVENT_TYPES.has(eventType)) return "config";
  if (PROVIDER_EVENT_TYPES.has(eventType)) return "provider";
  return "other";
}

/** Filtre la timeline par catégorie ("all" = aucune contrainte). */
export function filterAuditEvents(events: MissionAuditView[], filter: "all" | AuditCategory): MissionAuditView[] {
  if (filter === "all") return events;
  return events.filter((event) => auditEventCategory(event.eventType) === filter);
}

/** Compte des événements par catégorie (pour les badges des filtres). */
export function countAuditCategories(events: MissionAuditView[]): Record<AuditCategory, number> {
  const counts: Record<AuditCategory, number> = {
    transition: 0, delivery: 0, run: 0, gate: 0, config: 0, provider: 0, other: 0
  };
  for (const event of events) counts[auditEventCategory(event.eventType)] += 1;
  return counts;
}

/** Libellés lisibles des décisions de delivery (DELIVERY_DECIDED). */
const DELIVERY_DECISION_LABELS: Record<string, string> = {
  accept: "acceptée",
  "request-changes": "corrections demandées",
  reject: "rejetée"
};

/** Libellés lisibles des états de gate (GATE_EVALUATED / GATE_EVIDENCE_STALE). */
const GATE_STATE_LABELS: Record<string, string> = {
  passed: "passée",
  failed: "échouée",
  pending: "en attente",
  stale: "périmée",
  overridden: "outrepassée"
};

/**
 * Description enrichie d'un événement d'audit pour la timeline UI :
 * libellé de base + transition d'état, décision de delivery ou état de gate.
 */
export function describeAuditEvent(event: MissionAuditView): string {
  const base = describeBaseAuditEvent(event);
  if (event.eventType === "DELIVERY_DECIDED") {
    const decision = typeof event.payload?.decision === "string" ? event.payload.decision : "";
    const decisionLabel = DELIVERY_DECISION_LABELS[decision];
    if (decisionLabel) return `${base} — ${decisionLabel}`;
    return base;
  }
  if (event.eventType === "GATE_EVALUATED" || event.eventType === "GATE_EVIDENCE_STALE") {
    const state = typeof event.payload?.state === "string" ? event.payload.state : "";
    const stateLabel = GATE_STATE_LABELS[state];
    if (stateLabel) return `${base} — ${stateLabel}`;
    return base;
  }
  return base;
}

/** Libellés lisibles de l'acteur d'un événement d'audit. */
export function auditActorLabel(actor: MissionAuditView["actor"]): string {
  return actor === "manager" ? "Manager" : "Utilisateur";
}

/**
 * Horodatage lisible d'un événement d'audit : « 02 août · 08:30 ».
 * Retourne l'entrée brute si la date est invalide.
 */
export function formatAuditTime(occurredAt: string): string {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return occurredAt;
  const day = date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}
