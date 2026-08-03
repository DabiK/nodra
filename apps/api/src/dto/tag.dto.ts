import { IsNotEmpty, IsString, Matches, ValidateIf } from "class-validator";

/** Corps de création / mise à jour d'un tag libre de mission (issue #23). */
export class TagDto {
  @IsString() @IsNotEmpty() @Matches(/\S/) label!: string;
  @IsString() @Matches(/^#[0-9a-fA-F]{6}$/) color!: string;
  @ValidateIf((value) => value.commandId !== undefined) @IsString() commandId?: string;
}
