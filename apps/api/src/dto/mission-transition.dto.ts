import { IsInt, IsString, Min, ValidateIf } from "class-validator";
export class MissionTransitionDto { @IsInt() @Min(0) expectedVersion!: number; @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string; }
