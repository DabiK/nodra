import { IsInt, IsNotEmpty, IsString, Matches, Min, ValidateIf } from "class-validator";

export class DecideDeliveryDto {
  @IsString() @IsNotEmpty() @Matches(/\S/) comment!: string;
  @IsInt() @Min(0) expectedMissionVersion!: number;
  @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string;
}
