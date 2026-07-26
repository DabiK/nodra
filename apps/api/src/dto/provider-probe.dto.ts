import { Equals, IsBoolean } from "class-validator";

export class ProviderProbeDto {
  @IsBoolean()
  @Equals(true)
  optIn!: boolean;
}
