import { Type } from "class-transformer";
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, Min } from "class-validator";

export class ProviderSessionListQueryDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  providerId!: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
