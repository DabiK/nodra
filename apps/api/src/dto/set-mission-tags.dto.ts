import { IsArray, IsString } from "class-validator";

/** Remplace l'ensemble des tags d'une mission (issue #23) ; [] retire tous les tags. */
export class SetMissionTagsDto {
  @IsArray() @IsString({ each: true }) tagIds!: string[];
}
