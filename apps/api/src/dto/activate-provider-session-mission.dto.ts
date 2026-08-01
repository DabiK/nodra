import { IsInt, IsNotEmpty, IsString, Matches, Min } from "class-validator";

export class ActivateProviderSessionMissionDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsString() @IsNotEmpty() @Matches(/\S/) commandId!: string;
}
