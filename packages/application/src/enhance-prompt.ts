import { DomainError } from "@nodra/domain";
import type { ProviderOneShotPort } from "./provider-one-shot-model.js";
import type { ProviderOneShotRegistry } from "./provider-one-shot-registry.js";
import type { ProviderReasoningEffort } from "./provider-model.js";

export interface EnhancePromptInput {
  providerId: string;
  prompt: string;
  modelId?: string;
  reasoningEffort?: ProviderReasoningEffort;
}

export interface EnhancePromptResult {
  prompt: string;
}

const ENHANCE_INSTRUCTION = [
  "Tu es un spécialiste du prompt engineering.",
  "Enrichis le prompt ci-dessous pour le rendre plus précis et actionnable :",
  "ajoute du contexte, des contraintes, des critères de réussite et des étapes, sans changer son intention.",
  "Réponds uniquement avec le prompt enrichi, sans introduction ni commentaire.",
  "",
  "PROMPT À ENRICHIR :"
].join("\n");

export class EnhancePrompt {
  constructor(private readonly providers: ProviderOneShotRegistry) {}

  async execute(input: EnhancePromptInput): Promise<EnhancePromptResult> {
    const prompt = input.prompt.trim();
    if (!prompt) throw new DomainError("A prompt is required", "PROMPT_REQUIRED");
    const provider = this.resolve(input.providerId);
    const result = await provider.oneShot({
      prompt: `${ENHANCE_INSTRUCTION}\n\n${prompt}`,
      ...(input.modelId ? { modelId: input.modelId } : {}),
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {})
    });
    const text = result.text.trim();
    if (!text) throw new DomainError("The provider returned an empty enhancement", "PROMPT_ENHANCEMENT_EMPTY");
    return { prompt: text };
  }

  private resolve(providerId: string): ProviderOneShotPort {
    return this.providers.resolve(providerId);
  }
}
