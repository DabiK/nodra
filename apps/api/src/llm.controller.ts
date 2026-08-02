import { Body, Controller, HttpCode, Inject, Post } from "@nestjs/common";
import type { EnhancePrompt, ProviderReasoningEffort } from "@nodra/application";
import { ENHANCE_PROMPT } from "./tokens.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { EnhancePromptDto } from "./dto/enhance-prompt.dto.js";

@Controller("api/llm")
export class LlmController {
  constructor(@Inject(ENHANCE_PROMPT) private readonly enhancePrompt: EnhancePrompt) {}

  @Post("enhance")
  @HttpCode(200)
  async enhance(@Body() body: EnhancePromptDto) {
    const result = await this.enhancePrompt.execute({
      providerId: body.providerId,
      prompt: body.prompt,
      ...(body.modelId ? { modelId: body.modelId } : {}),
      ...(body.reasoningEffort ? { reasoningEffort: body.reasoningEffort as ProviderReasoningEffort } : {})
    });
    return { prompt: result.prompt };
  }
}
