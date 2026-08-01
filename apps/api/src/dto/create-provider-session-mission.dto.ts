import { Equals, IsNotEmpty, IsOptional, IsString, Matches } from "class-validator";

export class CreateProviderSessionMissionDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/)
  title?: string;

  @IsOptional()
  @IsString()
  @Matches(/\S/)
  projectId?: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  commandId!: string;

  @IsString()
  @Equals("read_only")
  mode!: "read_only";
}
