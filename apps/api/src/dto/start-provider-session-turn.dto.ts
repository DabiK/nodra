import { IsNotEmpty, IsString, Matches } from "class-validator";

export class StartProviderSessionTurnDto {
  @IsString() @IsNotEmpty() @Matches(/\S/) text!: string;
  @IsString() @IsNotEmpty() @Matches(/\S/) commandId!: string;
}
