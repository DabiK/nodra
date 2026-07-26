import { IsInt, IsObject, Min } from "class-validator";

export class ProviderOptionsDto {
  @IsInt() @Min(1) schemaVersion!: number;
  @IsObject() value!: Record<string, unknown>;
}
