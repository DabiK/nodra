import { IsBoolean, IsIn, IsOptional } from "class-validator";

export class ResolveWorktreeDto {
  @IsIn(["remove-all", "keep-branch"]) action!: "remove-all" | "keep-branch";
  @IsOptional() @IsBoolean() confirmDiscardChanges?: boolean;
  @IsOptional() @IsBoolean() confirmDeleteUnmerged?: boolean;
}
