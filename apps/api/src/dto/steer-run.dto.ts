import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class SteerRunDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100_000)
  text!: string;
}
