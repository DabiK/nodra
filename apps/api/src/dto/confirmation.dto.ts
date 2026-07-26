import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, Matches, ValidateIf } from "class-validator";

export class RequestConfirmationDto {
  @IsString() @IsNotEmpty() @Matches(/\S/) action!: string;
  @IsObject() target!: Record<string, unknown>;
  @IsOptional() @IsString() cwd?: string | null;
  @IsOptional() @IsString() providerId?: string | null;
  @IsOptional() @IsIn(["read_only", "workspace", "full_access"]) permissionPreset?: "read_only" | "workspace" | "full_access" | null;
  @IsString() @IsNotEmpty() @Matches(/\S/) risk!: string;
  @IsIn(["once", "run", "mission"]) scope!: "once" | "run" | "mission";
  @IsOptional() @IsString() runId?: string;
  @IsOptional() @IsString() missionId?: string;
  @IsOptional() @IsString() workspaceId?: string;
  @IsString() @IsNotEmpty() @Matches(/\S/) expiresAt!: string;
  @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string;
}
