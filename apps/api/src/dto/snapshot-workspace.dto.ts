import { IsNotEmpty, IsString, Matches, ValidateIf } from "class-validator";
export class SnapshotWorkspaceDto { @IsString() @IsNotEmpty() @Matches(/\S/) reason!: string; @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string; }
