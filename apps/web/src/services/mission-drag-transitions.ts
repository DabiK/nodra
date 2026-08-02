import type { MissionState, MissionView } from "../types";
import type { MissionActionId } from "./mission-ui-policy";

export type DragTransitionRoute = "ready" | "pickup" | "unblock" | "complete" | "accept" | "abandon";

export interface DragTransition {
  route: DragTransitionRoute;
  label: string;
}

type TransitionTable = Partial<Record<MissionState, Partial<Record<MissionState, DragTransitionRoute>>>>;

const HUMAN_TABLE: TransitionTable = {
  DRAFT: { READY: "ready", DONE: "complete", ABANDONED: "abandon" },
  READY: { ACTIVE: "pickup", DONE: "complete", ABANDONED: "abandon" },
  ACTIVE: { DONE: "complete" },
  BLOCKED: { READY: "unblock", ABANDONED: "abandon" },
  VALIDATION: { ABANDONED: "abandon" }
};

const AGENT_TABLE: TransitionTable = {
  DRAFT: { READY: "ready", ABANDONED: "abandon" },
  READY: { ABANDONED: "abandon" },
  BLOCKED: { READY: "unblock", ABANDONED: "abandon" },
  VALIDATION: { DONE: "accept", ABANDONED: "abandon" }
};

const ROUTE_LABELS: Record<DragTransitionRoute, string> = {
  ready: "Marquer READY",
  pickup: "Prendre en charge",
  unblock: "Remettre READY",
  complete: "Terminer",
  accept: "Valider",
  abandon: "Abandonner"
};

/** Drag & drop transition from the mission's state to a target state, or null when forbidden. */
export function findDragTransition(mission: MissionView, targetState: MissionState): DragTransition | null {
  const table = mission.executionKind === "agent" ? AGENT_TABLE : HUMAN_TABLE;
  const route = table[mission.state]?.[targetState];
  if (!route) return null;
  return { route, label: ROUTE_LABELS[route] };
}

/** Map a drag route to the UI action id used by performMissionAction. */
export function dragActionId(transition: DragTransition): MissionActionId {
  const mapping: Record<DragTransitionRoute, MissionActionId> = {
    ready: "mark-ready",
    pickup: "pickup",
    unblock: "resume",
    complete: "complete-human",
    accept: "validate",
    abandon: "abandon"
  };
  return mapping[transition.route];
}
