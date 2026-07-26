import { IsOptional, IsString, ValidateIf } from "class-validator";
export class DeleteWorkspaceDto { @IsOptional() @IsString() confirmationId?: string; @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string; }
