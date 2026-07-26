import { IsIn, IsNotEmpty, IsString, Matches, ValidateIf } from "class-validator";

export class DecideConfirmationDto {
  @IsIn(["approved", "denied"]) decision!: "approved" | "denied";
  @IsString() @IsNotEmpty() @Matches(/\S/) actor!: string;
  @IsString() @IsNotEmpty() @Matches(/\S/) comment!: string;
  @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string;
}
