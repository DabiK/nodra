import { IsNotEmpty, IsString, Matches } from "class-validator";

export class ProviderSessionIdDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  id!: string;
}
