import { IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from "class-validator";
export class CommitWorkspaceDto { @IsString() @IsNotEmpty() @Matches(/\S/) missionId!: string; @IsString() @IsNotEmpty() @Matches(/\S/) message!: string; @IsOptional() @IsString() confirmationId?: string; @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string; }
