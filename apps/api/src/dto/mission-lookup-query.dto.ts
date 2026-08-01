import { IsNotEmpty, IsString, Matches } from "class-validator";

export class MissionLookupQueryDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  missionId!: string;
}
