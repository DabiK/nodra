import { IsString, ValidateIf } from "class-validator";

export class CollectGitEvidenceDto {
  @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string;
}
