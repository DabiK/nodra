import { api } from "../api";
import type { MissionView, PipelineView } from "../types";

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
