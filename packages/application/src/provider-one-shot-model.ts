import type { ProviderReasoningEffort } from "./provider-model.js";

export interface ProviderOneShotInput {
  prompt: string;
  modelId?: string;
  reasoningEffort?: ProviderReasoningEffort;
}

export interface ProviderOneShotResult {
  text: string;
}

export interface ProviderOneShotPort {
  readonly providerId: string;
  oneShot(input: ProviderOneShotInput): Promise<ProviderOneShotResult>;
}
