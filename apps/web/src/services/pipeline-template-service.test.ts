// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderOptionsCatalog } from "../types";
import { createConfiguredMission, createHumanMission } from "./mission-service";
import { createPipeline } from "./pipeline-service";
import { createExamplePipeline, EXAMPLE_PIPELINE_NAME, exampleAgentDraft, EXAMPLE_REVIEW_PROMPT } from "./pipeline-template-service";

vi.mock("./mission-service", () => ({
  createConfiguredMission: vi.fn(),
  createHumanMission: vi.fn()
}));
vi.mock("./pipeline-service", () => ({
  createPipeline: vi.fn()
}));

afterEach(() => {
  vi.clearAllMocks();
});

const catalog: ProviderOptionsCatalog = {
  providers: [],
  reasoningEfforts: ["provider_default", "minimal", "low", "medium", "high", "xhigh"],
  permissionPresets: ["read_only", "workspace", "full_access"],
  defaults: {
    providerId: "opencode",
    modelId: "opencode/deepseek-v4-flash-free",
    reasoningEffort: "high",
    permissionPreset: "workspace",
    providerOptions: { schemaVersion: 1, value: {} }
  }
};

describe("pipeline-template-service", () => {
  it("pré-remplit le brouillon de l'étape agent avec le prompt de revue et les réglages par défaut", () => {
    const draft = exampleAgentDraft(catalog);
    expect(draft.kind).toBe("agent");
    expect(draft.title).toBe("Revue de code");
    expect(draft.prompt).toBe(EXAMPLE_REVIEW_PROMPT);
    expect(draft.providerId).toBe("opencode");
    expect(draft.modelId).toBe("opencode/deepseek-v4-flash-free");
    expect(draft.permissionPreset).toBe("workspace");
  });

  it("crée 2 missions (agent puis humaine) et un pipeline de 2 nœuds enchaînés", async () => {
    vi.mocked(createConfiguredMission).mockResolvedValue({ id: "mission-1", title: "Revue de code" } as never);
    vi.mocked(createHumanMission).mockResolvedValue({ id: "mission-2", title: "Livraison manuelle" } as never);
    vi.mocked(createPipeline).mockResolvedValue({ id: "pipeline-1", name: EXAMPLE_PIPELINE_NAME } as never);

    const pipeline = await createExamplePipeline(catalog);

    expect(pipeline.id).toBe("pipeline-1");
    expect(createConfiguredMission).toHaveBeenCalledTimes(1);
    expect(createConfiguredMission).toHaveBeenCalledWith(expect.objectContaining({ title: "Revue de code" }), catalog);
    expect(createHumanMission).toHaveBeenCalledTimes(1);
    expect(createHumanMission).toHaveBeenCalledWith({ title: "Livraison manuelle" });
    expect(createPipeline).toHaveBeenCalledWith({
      name: EXAMPLE_PIPELINE_NAME,
      nodes: [
        { nodeKey: "review", missionId: "mission-1" },
        { nodeKey: "ship", missionId: "mission-2" }
      ],
      edges: [{ fromNodeKey: "review", toNodeKey: "ship" }]
    });
  });
});
