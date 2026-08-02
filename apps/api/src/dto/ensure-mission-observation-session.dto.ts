import { IsNotEmpty, IsString, Matches } from "class-validator";

export class EnsureMissionObservationSessionDto {
  @IsString() @IsNotEmpty() @Matches(/\S/) commandId!: string;
}
