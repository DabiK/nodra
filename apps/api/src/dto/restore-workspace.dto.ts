import { IsString, ValidateIf } from "class-validator";
export class RestoreWorkspaceDto { @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string; }
