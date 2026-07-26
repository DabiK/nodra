import { IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from "class-validator";

export class CreateMissionDto {
  @IsString() @IsNotEmpty() @Matches(/\S/) title!: string;
  @IsOptional() @IsString() projectId?: string | null;
  @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string;
}
