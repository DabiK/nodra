import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested
} from "class-validator";
import { ProviderOptionsDto } from "./provider-options.dto.js";

export class UpdateAgentConfigDto {
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
  @IsString() @IsNotEmpty() providerId!: string;
  @IsString() @IsNotEmpty() modelId!: string;
  @IsIn(["minimal", "low", "medium", "high", "xhigh", "provider_default"])
  reasoningEffort!: "minimal" | "low" | "medium" | "high" | "xhigh" | "provider_default";
  @ValidateNested() @Type(() => ProviderOptionsDto) providerOptions!: ProviderOptionsDto;
  @IsString() @Matches(/\S/) missionPrompt!: string;
  @IsIn(["read_only", "workspace", "full_access"])
  permissionPreset!: "read_only" | "workspace" | "full_access";
  @IsString() @IsNotEmpty() workspaceId!: string;
  @IsBoolean() autoCommitAuthorized!: boolean;
  @IsOptional() @IsString() integrationTargetRef?: string | null;
  @IsOptional() @IsString() commandId?: string;
}
