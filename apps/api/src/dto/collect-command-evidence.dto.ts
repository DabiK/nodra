import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min, ValidateIf } from "class-validator";

export class CollectCommandEvidenceDto {
  @IsArray() @IsString({ each: true }) argv!: string[];
  @IsString() @IsNotEmpty() @Matches(/\S/) cwd!: string;
  @IsOptional() @IsInt() @Min(0) timeoutMs?: number;
  @IsOptional() @IsInt() @Min(0) maxOutputBytes?: number;
  @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string;
}
