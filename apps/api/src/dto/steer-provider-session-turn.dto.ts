import { IsNotEmpty, IsOptional, IsString, Matches } from "class-validator";

export class SteerProviderSessionTurnDto {
  @IsString() @IsNotEmpty() @Matches(/\S/) externalTurnId!: string;
  @IsString() @IsNotEmpty() @Matches(/\S/) text!: string;
  @IsString() @IsNotEmpty() @Matches(/\S/) commandId!: string;
  @IsOptional() @IsString() @Matches(/\S/) modelId?: string;
  @IsOptional() @IsString() @Matches(/^(provider_default|minimal|low|medium|high|xhigh)$/) reasoningEffort?: string;
}
