import { IsInt, IsOptional, IsString, Min } from "class-validator";

export class EnableAgentConfigDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsOptional() @IsString() commandId?: string;
}
