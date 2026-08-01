import { IsNotEmpty, IsString, Matches } from "class-validator";

export class ProviderSessionCapabilitiesQueryDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  providerId!: string;
}
