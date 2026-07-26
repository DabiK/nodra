import { IsInt, IsNotEmpty, IsObject, IsString, Matches, Min, ValidateIf } from "class-validator";

export class DefineGateDto {
  @IsString() @IsNotEmpty() @Matches(/\S/) missionId!: string;
  @IsString() @IsNotEmpty() @Matches(/\S/) name!: string;
  @IsString() @IsNotEmpty() @Matches(/\S/) evaluatorId!: string;
  @IsString() @IsNotEmpty() @Matches(/\S/) evaluatorVersion!: string;
  @IsInt() @Min(0) criteriaSchemaVersion!: number;
  @IsObject() criteria!: Record<string, unknown>;
  @IsObject() expectedEvidence!: Record<string, unknown>;
  @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string;
}
