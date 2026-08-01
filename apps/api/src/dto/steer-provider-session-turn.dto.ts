import { IsNotEmpty, IsString, Matches } from "class-validator";

export class SteerProviderSessionTurnDto {
  @IsString() @IsNotEmpty() @Matches(/\S/) externalTurnId!: string;
  @IsString() @IsNotEmpty() @Matches(/\S/) text!: string;
  @IsString() @IsNotEmpty() @Matches(/\S/) commandId!: string;
}
