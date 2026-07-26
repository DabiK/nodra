import { IsArray, IsString, IsNotEmpty, Matches, ValidateIf } from "class-validator";
export class EvaluateGateDto {
  @IsString() @IsNotEmpty() @Matches(/\S/) runId!: string;
  @IsArray() @IsString({ each: true }) evidenceIds!: string[];
  @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string;
}
