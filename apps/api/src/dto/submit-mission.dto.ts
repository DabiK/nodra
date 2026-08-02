import { IsInt, IsString, Min, ValidateIf } from "class-validator";
export class SubmitMissionDto { @IsInt() @Min(0) expectedVersion!: number; @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string; @ValidateIf((value) => value.declaredResult !== undefined) @IsString() declaredResult?: string; }
