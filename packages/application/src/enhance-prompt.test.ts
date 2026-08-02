import { describe, expect, it, vi } from "vitest";
import { EnhancePrompt } from "./enhance-prompt.js";
import type { ProviderOneShotInput, ProviderOneShotPort } from "./provider-one-shot-model.js";
import { ProviderOneShotRegistry } from "./provider-one-shot-registry.js";

describe("EnhancePrompt", () => {
  it("delegates to the chosen provider and returns its text trimmed", async () => {
    const oneShot = vi.fn(async (_input: ProviderOneShotInput) => ({ text: "  Prompt enrichi avec détails.  " }));
    const provider: ProviderOneShotPort = { providerId: "opencode", oneShot };
    const useCase = new EnhancePrompt(new ProviderOneShotRegistry([provider]));

    const result = await useCase.execute({
      providerId: "opencode",
      prompt: " Fais un truc ",
      modelId: "openai/gpt-5",
      reasoningEffort: "high"
    });

    expect(result.prompt).toBe("Prompt enrichi avec détails.");
    expect(oneShot.mock.calls).toHaveLength(1);
    const sent = oneShot.mock.calls[0]![0];
    expect(sent.prompt).toContain("PROMPT À ENRICHIR :");
    expect(sent.prompt).toContain("\n\nFais un truc");
    expect(sent.modelId).toBe("openai/gpt-5");
    expect(sent.reasoningEffort).toBe("high");
  });

  it("omits optional run fields when not provided", async () => {
    const oneShot = vi.fn(async (input: ProviderOneShotInput) => ({ text: input.prompt }));
    const provider: ProviderOneShotPort = { providerId: "codex", oneShot };
    const useCase = new EnhancePrompt(new ProviderOneShotRegistry([provider]));

    await useCase.execute({ providerId: "codex", prompt: "Salut" });

    expect(oneShot.mock.calls).toHaveLength(1);
    expect(oneShot.mock.calls[0]![0].prompt).toContain("Salut");
  });

  it("rejects an empty prompt and an unknown provider", async () => {
    const provider: ProviderOneShotPort = {
      providerId: "opencode",
      oneShot: async () => ({ text: "OK" })
    };
    const useCase = new EnhancePrompt(new ProviderOneShotRegistry([provider]));

    await expect(useCase.execute({ providerId: "opencode", prompt: "  " })).rejects.toMatchObject({
      code: "PROMPT_REQUIRED"
    });
    await expect(useCase.execute({ providerId: "codex", prompt: "Salut" })).rejects.toMatchObject({
      code: "PROVIDER_ONE_SHOT_PROVIDER_NOT_FOUND"
    });
  });

  it("rejects an empty enhancement returned by the provider", async () => {
    const provider: ProviderOneShotPort = {
      providerId: "opencode",
      oneShot: async () => ({ text: "   " })
    };
    const useCase = new EnhancePrompt(new ProviderOneShotRegistry([provider]));

    await expect(useCase.execute({ providerId: "opencode", prompt: "Salut" })).rejects.toMatchObject({
      code: "PROMPT_ENHANCEMENT_EMPTY"
    });
  });
});
