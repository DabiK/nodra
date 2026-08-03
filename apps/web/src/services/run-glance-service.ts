import type { ManagerView, MissionView, PipelineListItem } from "../types";

/** États de run où l'agent travaille encore : le live s'affiche pour ces runs (miroir du read model API). */
export const ACTIVE_RUN_STATES = new Set(["QUEUED", "STARTING", "RUNNING", "WAITING_APPROVAL", "CANCELLING"]);

/** Libellé lisible de l'activité en cours d'un run actif. */
export const RUN_STATE_LIVE_LABEL: Record<string, string> = {
  QUEUED: "en file d'attente",
  STARTING: "démarre…",
  RUNNING: "réfléchit…",
  WAITING_APPROVAL: "attend une approbation",
  CANCELLING: "annulation…"
};

export type RunGlanceKind = "mission" | "pipeline" | "manager";

export interface RunGlanceItem {
  kind: RunGlanceKind;
  id: string;
  title: string;
  /** Dernière action/événement en live (message, nœud actif, dernier retour). */
  detail: string;
  /** Début du run (temps écoulé), null si inconnu. */
  startedAt: string | null;
  /** Libellé lisible de l'état de connexion/du run. */
  stateLabel: string;
  /** Ton du point de statut (classe CSS). */
  tone: string;
}

/** États de run de pipeline où le run travaille encore. */
const PIPELINE_ACTIVE_STATES = new Set(["queued", "active", "blocked"]);

const PIPELINE_STATE_LABEL: Record<string, string> = {
  queued: "en file d'attente",
  active: "en cours",
  blocked: "bloqué"
};

function missionGlanceItem(mission: MissionView): RunGlanceItem | null {
  if (mission.state !== "ACTIVE" || mission.runState === null || !ACTIVE_RUN_STATES.has(mission.runState)) return null;
  const stateLabel = RUN_STATE_LIVE_LABEL[mission.runState] ?? "réfléchit…";
  return {
    kind: "mission",
    id: mission.id,
    title: mission.title,
    detail: mission.lastAssistantMessage ?? stateLabel,
    startedAt: mission.runStartedAt,
    stateLabel,
    tone: "running"
  };
}

function pipelineGlanceItem(pipeline: PipelineListItem): RunGlanceItem | null {
  if (pipeline.runState === null || !PIPELINE_ACTIVE_STATES.has(pipeline.runState)) return null;
  const activeNode = pipeline.nodes.find((node) =>
    node.nodeRunState === "active" || node.nodeRunState === "ready" || node.nodeRunState === "blocked"
  );
  return {
    kind: "pipeline",
    id: pipeline.id,
    title: pipeline.name,
    detail: activeNode ? `${activeNode.nodeKey} · ${activeNode.missionTitle}` : "avancement du run…",
    startedAt: pipeline.startedAt,
    stateLabel: PIPELINE_STATE_LABEL[pipeline.runState] ?? pipeline.runState,
    tone: pipeline.runState === "blocked" ? "blocked" : "running"
  };
}

function managerGlanceItem(manager: ManagerView): RunGlanceItem | null {
  if (manager.state !== "active") return null;
  return {
    kind: "manager",
    id: manager.id,
    title: manager.name,
    detail: manager.lastMessage ?? "orchestration en cours",
    startedAt: manager.updatedAt,
    stateLabel: "en orchestration",
    tone: "manager"
  };
}

/**
 * Agrège tous les runs actifs visibles d'un coup d'œil : missions en run,
 * pipelines en run et managers actifs. Tri par ancienneté de début (les runs
 * qui tournent le plus longtemps d'abord), puis par titre pour la stabilité.
 * Pure : rien n'est chargé ici — les entrées viennent du board déjà rafraîchi
 * par le flux SSE (aucun polling additionnel).
 */
export function buildRunGlance(input: { missions: MissionView[]; pipelines: PipelineListItem[]; managers: ManagerView[] }): RunGlanceItem[] {
  const items = [
    ...input.missions.map(missionGlanceItem),
    ...input.pipelines.map(pipelineGlanceItem),
    ...input.managers.map(managerGlanceItem)
  ].filter((item): item is RunGlanceItem => item !== null);
  items.sort((left, right) => {
    const leftTime = left.startedAt ? Date.parse(left.startedAt) : Number.MAX_SAFE_INTEGER;
    const rightTime = right.startedAt ? Date.parse(right.startedAt) : Number.MAX_SAFE_INTEGER;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.title.localeCompare(right.title);
  });
  return items;
}

/** Temps écoulé depuis le début du run (libellé compact, `now` injectable). */
export function formatGlanceElapsed(startedAt: string | null, now: number): string {
  if (!startedAt) return "";
  const diff = now - Date.parse(startedAt);
  if (!Number.isFinite(diff) || diff < 0) return "";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}
