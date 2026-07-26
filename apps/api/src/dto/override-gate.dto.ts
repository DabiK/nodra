import { IsIn, IsNotEmpty, IsString, Matches, ValidateIf } from "class-validator";
export class OverrideGateDto {
  @IsString() @IsNotEmpty() @Matches(/\S/) approvalId!: string;
  @IsIn(["accept", "reject", "waive"]) decision!: "accept" | "reject" | "waive";
  @IsString() @IsNotEmpty() @Matches(/\S/) comment!: string;
  @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string;
}
