import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsOptional, IsString, ValidateNested } from "class-validator";

export class PipelineNodeDto {
  @IsString()
  nodeKey!: string;

  @IsString()
  missionId!: string;
}

export class CreatePipelineDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  commandId?: string;

  @IsString()
  name!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => PipelineNodeDto)
  nodes!: PipelineNodeDto[];
}

export class StartPipelineDto {
  @IsOptional()
  @IsString()
  runId?: string;

  @IsOptional()
  @IsString()
  commandId?: string;
}

export class AdvancePipelineDto {
  @IsOptional()
  @IsString()
  commandId?: string;
}
