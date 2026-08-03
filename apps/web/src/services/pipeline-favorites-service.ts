import type { AgentConfigView, PipelineListItem } from "../types";
import { createHumanMission, duplicateMission, loadMissionInspector } from "./mission-service";
import { createPipeline } from "./pipeline-service";

const STORAGE_KEY = "nodra.pipelines.favorites";

export interface PipelineFavoriteNode {
  nodeKey: string;
  title: string;
  kind: "agent" | "human";
  transitionMode: "auto" | "human";
  source?: AgentConfigView;
  projectId: string | null;
}

export interface PipelineFavorite {
  id: string;
  name: string;
  nodes: PipelineFavoriteNode[];
  edges: Array<{ fromNodeKey: string; toNodeKey: string }>;
  createdAt: string;
}

function valid(value: unknown): value is PipelineFavorite[] {
  return Array.isArray(value) && value.every((item) => item && typeof item === "object" && typeof item.id === "string" && typeof item.name === "string" && Array.isArray(item.nodes) && Array.isArray(item.edges));
}

export function loadPipelineFavorites(): PipelineFavorite[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return valid(value) ? value : [];
  } catch { return []; }
}

function save(favorites: PipelineFavorite[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites)); } catch { /* private mode */ }
}

export function renamePipelineFavorite(id: string, name: string): PipelineFavorite[] {
  const next = loadPipelineFavorites().map((favorite) => favorite.id === id ? { ...favorite, name: name.trim() || favorite.name } : favorite);
  save(next); return next;
}

export function deletePipelineFavorite(id: string): PipelineFavorite[] {
  const next = loadPipelineFavorites().filter((favorite) => favorite.id !== id);
  save(next); return next;
}

/** Captures configuration, never mission IDs: a favorite always creates fresh missions. */
export async function savePipelineFavorite(pipeline: PipelineListItem): Promise<PipelineFavorite> {
  const details = await Promise.all(pipeline.nodes.map((node) => loadMissionInspector(node.missionId)));
  const favorite: PipelineFavorite = {
    id: crypto.randomUUID(), name: pipeline.name, createdAt: new Date().toISOString(), edges: pipeline.edges,
    nodes: pipeline.nodes.map((node, index) => {
      const mission = details[index].mission;
      return { nodeKey: node.nodeKey, title: node.missionTitle, kind: mission.executionKind, transitionMode: node.transitionMode,
        ...(details[index].config ? { source: details[index].config } : {}), projectId: mission.projectId };
    })
  };
  save([favorite, ...loadPipelineFavorites()]);
  return favorite;
}

export async function createPipelineFromFavorite(favorite: PipelineFavorite): Promise<{ id: string; name: string }> {
  const missions = await Promise.all(favorite.nodes.map(async (node) => {
    if (node.kind === "agent" && node.source) return duplicateMission({ title: node.title, projectId: node.projectId, source: node.source, modelId: node.source.modelId ?? "" });
    return createHumanMission({ title: node.title, projectId: node.projectId });
  }));
  return createPipeline({ name: favorite.name, nodes: favorite.nodes.map((node, index) => ({ nodeKey: node.nodeKey, missionId: missions[index].id, transitionMode: node.transitionMode })), edges: favorite.edges });
}
