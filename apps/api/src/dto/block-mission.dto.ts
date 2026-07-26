import { IsInt, IsNotEmpty, IsString, Matches, Min, ValidateIf } from "class-validator";
export class BlockMissionDto { @IsString() @IsNotEmpty() @Matches(/\S/) reason!: string; @IsInt() @Min(0) expectedVersion!: number; @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string; }
