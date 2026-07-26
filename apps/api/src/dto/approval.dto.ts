import { IsIn, IsNotEmpty, IsString, Matches, ValidateIf } from "class-validator";

export class RequestApprovalDto {
  @IsIn(["run", "mission", "manager"]) subjectType!: "run" | "mission" | "manager";
  @IsString() @IsNotEmpty() @Matches(/\S/) subjectId!: string;
  @IsString() @IsNotEmpty() @Matches(/\S/) kind!: string;
  @ValidateIf((value) => value.expiresAt !== undefined) @IsString() expiresAt?: string;
  @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string;
}
