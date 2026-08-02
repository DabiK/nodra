import { IsNotEmpty, IsOptional, IsString, Matches } from "class-validator";

export class EnhancePromptDto {
  @IsString() @IsNotEmpty() @Matches(/\S/) prompt!: string;
  @IsString() @IsNotEmpty() @Matches(/\S/) providerId!: string;
  @IsOptional() @IsString() @Matches(/\S/) modelId?: string;
  @IsOptional() @IsString() @Matches(/^(provider_default|minimal|low|medium|high|xhigh)$/) reasoningEffort?: string;
}
