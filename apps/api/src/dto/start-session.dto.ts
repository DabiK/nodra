import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class StartSessionDto {
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
  @IsOptional() @IsString() @MaxLength(100_000) message?: string;
  @IsOptional() @IsString() commandId?: string;
}
