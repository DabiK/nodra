import { IsInt, IsOptional, Max, Min } from "class-validator";

export class DispatchRuntimeDto {
  @IsOptional() @IsInt() @Min(1) @Max(1000) limit?: number;
}
