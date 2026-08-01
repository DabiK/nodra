import { Equals, IsNotEmpty, IsString, Matches } from "class-validator";

export class AttachProviderSessionDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  missionId!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  commandId!: string;

  @IsString()
  @Equals("read_only")
  mode!: "read_only";
}
