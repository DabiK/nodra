import { api } from "../api";
import type { MissionView, PipelineListItem, PipelineView } from "../types";

export async function listPipelines() {
  return api<PipelineListItem[]>("/api/pipelines");
}

export async function startPipeline(pipelineId: string) {
  return api(`/api/pipelines/${pipelineId}/start`, { method: "POST", body: "{}" });
}

export async function advancePipelineRun(runId: string) {
  return api(`/api/pipelines/runs/${runId}/advance`, { method: "POST", body: "{}" });
}

export async function setNodeTransitionMode(runId: string, nodeKey: string, mode: "auto" | "human") {
  return api(`/api/pipelines/runs/${runId}/nodes/${encodeURIComponent(nodeKey)}/mode`, {
    method: "POST",
    body: JSON.stringify({ mode })
  });
}

export async function approveNodeTransition(runId: string, nodeKey: string) {
  return api(`/api/pipelines/runs/${runId}/nodes/${encodeURIComponent(nodeKey)}/approve-transition`, { method: "POST", body: "{}" });
}

export async function publishNodeHandover(runId: string, nodeKey: string) {
  return api(`/api/pipelines/runs/${runId}/nodes/${encodeURIComponent(nodeKey)}/publish-handover`, { method: "POST", body: "{}" });
}

export interface CreatePipelineInput {
  name: string;
  nodes: Array<{ nodeKey: string; missionId: string }>;
  edges?: Array<{ fromNodeKey: string; toNodeKey: string }>;
}

export async function createPipeline(input: CreatePipelineInput) {
  return api<PipelineView>("/api/pipelines", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function createPrerequisitePipeline(input: {
  mission: MissionView;
  prerequisiteMissionIds: string[];
}) {
  const nodes = [
    ...input.prerequisiteMissionIds.map((missionId, index) => ({
      nodeKey: `pre_${index + 1}`,
      missionId
    })),
    { nodeKey: "current", missionId: input.mission.id }
  ];
  return api<PipelineView>("/api/pipelines", {
    method: "POST",
    body: JSON.stringify({
      name: `Sequence · ${input.mission.title}`,
      nodes,
      edges: input.prerequisiteMissionIds.map((_, index) => ({
        fromNodeKey: `pre_${index + 1}`,
        toNodeKey: "current"
      }))
    })
  });
}
