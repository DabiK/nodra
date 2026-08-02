import { api } from "../api";
import type { ProviderReasoningEffort } from "../types";

export interface EnhancePromptRequest {
  prompt: string;
  providerId: string;
  modelId?: string;
  reasoningEffort?: ProviderReasoningEffort;
}

export function enhancePrompt(request: EnhancePromptRequest) {
  return api<{ prompt: string }>("/api/llm/enhance", {
    method: "POST",
    body: JSON.stringify(request)
  });
}
