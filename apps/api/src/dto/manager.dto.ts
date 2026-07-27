import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "provider_default"];
const PERMISSIONS = ["read_only", "workspace", "full_access"];

export class CreateManagerDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsString() @MinLength(1) @MaxLength(100_000) instruction!: string;
  @IsOptional() @IsString() providerId?: string;
  @IsOptional() @IsString() modelId?: string;
  @IsOptional() @IsIn(EFFORTS) reasoningEffort?: string;
  @IsOptional() @IsIn(PERMISSIONS) permissionPreset?: string;
  @IsOptional() @IsString() workspaceId?: string;
  @IsOptional() @IsString() commandId?: string;
}

export class UpdateManagerDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(100_000) instruction?: string;
  @IsOptional() @IsString() providerId?: string;
  @IsOptional() @IsString() modelId?: string;
  @IsOptional() @IsIn(EFFORTS) reasoningEffort?: string;
  @IsOptional() @IsIn(PERMISSIONS) permissionPreset?: string;
  @IsOptional() @IsString() workspaceId?: string;
  @IsOptional() @IsString() commandId?: string;
}

export class ManagerMessageDto {
  @IsString() @MinLength(1) @MaxLength(100_000) message!: string;
  @IsOptional() @IsString() threadId?: string;
  @IsOptional() newConversation?: boolean;
  @IsOptional() @IsString() commandId?: string;
}
