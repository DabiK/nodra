import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min, ValidateIf } from "class-validator";

export class DeclareDeliveryDto {
  @IsString() @IsNotEmpty() @Matches(/\S/) agentDeclaration!: string;
  @IsOptional() @IsString() observationSummary?: string;
  @IsInt() @Min(0) expectedMissionVersion!: number;
  @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string;
}
