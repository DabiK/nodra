import type { PipelineListItem, PipelineListNode } from "../types";

export type PipelineViewMode = "graph" | "timeline";

const KEY = "nodra.pipelines.view";

/** Read the persisted pipeline view mode (default: handover graph). */
export function loadPipelineViewMode(): PipelineViewMode {
  try {
    return localStorage.getItem(KEY) === "timeline" ? "timeline" : "graph";
  } catch {
    return "graph";
  }
}

/** Persist the pipeline view mode so it survives navigation and reloads. */
export function savePipelineViewMode(mode: PipelineViewMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* ignore storage failures (quota / private mode) */
  }
}

/** Durée du dernier run de mission d'un nœud, en millisecondes (null si inconnue). */
export function nodeDurationMs(node: PipelineListNode): number | null {
  if (!node.runStartedAt) return null;
  const start = Date.parse(node.runStartedAt);
  if (Number.isNaN(start)) return null;
  if (!node.runEndedAt) return null;
  const end = Date.parse(node.runEndedAt);
  if (Number.isNaN(end)) return null;
  return Math.max(0, end - start);
}

/** Durée totale du pipeline : run de pipeline si borné, sinon somme des durées de nœuds. */
export function pipelineTotalDurationMs(pipeline: PipelineListItem): number | null {
  if (pipeline.startedAt && pipeline.endedAt) {
    const start = Date.parse(pipeline.startedAt);
    const end = Date.parse(pipeline.endedAt);
    if (!Number.isNaN(start) && !Number.isNaN(end)) return Math.max(0, end - start);
  }
  let total = 0;
  for (const node of pipeline.nodes) {
    const duration = nodeDurationMs(node);
    if (duration === null) return null;
    total += duration;
  }
  return total;
}

/** Format humanisé d'une durée en millisecondes : "45 s", "1 min 05 s", "2 h 12 min". */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
  return `${seconds} s`;
}

/**
 * Ordre chronologique de la timeline : par début de run ascendant ;
 * les étapes jamais exécutées arrivent en fin, triées par nodeKey (ordre de définition).
 */
export function sortTimelineNodes(nodes: PipelineListNode[]): PipelineListNode[] {
  return [...nodes].sort((a, b) => {
    const aStart = a.runStartedAt ? Date.parse(a.runStartedAt) : Number.MAX_SAFE_INTEGER;
    const bStart = b.runStartedAt ? Date.parse(b.runStartedAt) : Number.MAX_SAFE_INTEGER;
    if (aStart !== bStart) return aStart - bStart;
    return a.nodeKey.localeCompare(b.nodeKey);
  });
}

/** Horaires de début/fin du dernier run, formatés en HH:MM:SS. */
export function runTimeRange(node: PipelineListNode): string | null {
  if (!node.runStartedAt) return null;
  const start = new Date(node.runStartedAt);
  const end = node.runEndedAt ? new Date(node.runEndedAt) : null;
  const fmt = (date: Date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return end ? `${fmt(start)} → ${fmt(end)}` : `${fmt(start)} → en cours`;
}
