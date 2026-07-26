import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from "class-validator";

export class CreateWorkspaceDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsIn(["repo", "scratch", "worktree"]) kind!: "repo" | "scratch" | "worktree";
  @IsString() @IsNotEmpty() @Matches(/\S/) path!: string;
  @IsOptional() @IsString() sourceWorkspaceId?: string;
  @IsOptional() @IsString() baseRef?: string;
  @IsOptional() @IsString() branchName?: string;
  @IsOptional() @IsString() integrationTargetRef?: string | null;
  @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string;
}
