// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHumanMission, duplicateMission, loadMissionInspector } from "./mission-service";
import { createPipeline } from "./pipeline-service";
import { createPipelineFromFavorite, deletePipelineFavorite, loadPipelineFavorites, renamePipelineFavorite, savePipelineFavorite, type PipelineFavorite } from "./pipeline-favorites-service";

vi.mock("./mission-service", () => ({ createHumanMission: vi.fn(), duplicateMission: vi.fn(), loadMissionInspector: vi.fn() }));
vi.mock("./pipeline-service", () => ({ createPipeline: vi.fn() }));
afterEach(() => { localStorage.clear(); vi.clearAllMocks(); });

const favorite: PipelineFavorite = { id: "fav", name: "Revue", createdAt: "2026-08-03T00:00:00Z", edges: [{ fromNodeKey: "a", toNodeKey: "b" }], nodes: [
  { nodeKey: "a", title: "Analyse", kind: "agent", transitionMode: "human", projectId: null, source: { modelId: "model", providerId: "codex" } as never },
  { nodeKey: "b", title: "Livraison", kind: "human", transitionMode: "auto", projectId: null }
] };

describe("pipeline-favorites-service", () => {
  it("restores safely, renames and deletes favorites", () => {
    localStorage.setItem("nodra.pipelines.favorites", JSON.stringify([favorite]));
    expect(renamePipelineFavorite("fav", "Nouvelle revue")[0].name).toBe("Nouvelle revue");
    expect(deletePipelineFavorite("fav")).toEqual([]);
    localStorage.setItem("nodra.pipelines.favorites", "not json");
    expect(loadPipelineFavorites()).toEqual([]);
  });

  it("captures node configuration without retaining mission IDs", async () => {
    vi.mocked(loadMissionInspector).mockResolvedValueOnce({ mission: { executionKind: "agent", projectId: null }, config: favorite.nodes[0].source } as never)
      .mockResolvedValueOnce({ mission: { executionKind: "human", projectId: null }, config: null } as never);
    const saved = await savePipelineFavorite({ id: "pipeline", name: "Revue", nodes: [{ ...({ missionId: "old-a", missionTitle: "Analyse", nodeKey: "a", transitionMode: "human" } as never) }, { ...({ missionId: "old-b", missionTitle: "Livraison", nodeKey: "b", transitionMode: "auto" } as never) }], edges: favorite.edges } as never);
    expect(saved.nodes[0]).not.toHaveProperty("missionId");
    expect(loadPipelineFavorites()).toHaveLength(1);
  });

  it("creates fresh missions then a pipeline with copied modes", async () => {
    vi.mocked(duplicateMission).mockResolvedValue({ id: "new-a" } as never);
    vi.mocked(createHumanMission).mockResolvedValue({ id: "new-b" } as never);
    vi.mocked(createPipeline).mockResolvedValue({ id: "pipeline-new", name: "Revue" } as never);
    await createPipelineFromFavorite(favorite);
    expect(duplicateMission).toHaveBeenCalledWith(expect.objectContaining({ title: "Analyse" }));
    expect(createHumanMission).toHaveBeenCalledWith({ title: "Livraison", projectId: null });
    expect(createPipeline).toHaveBeenCalledWith(expect.objectContaining({ nodes: [{ nodeKey: "a", missionId: "new-a", transitionMode: "human" }, { nodeKey: "b", missionId: "new-b", transitionMode: "auto" }] }));
  });
});
