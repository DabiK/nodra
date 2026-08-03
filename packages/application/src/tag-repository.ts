import { DomainError, type Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";

/**
 * Tags libres des missions (issue #23) : libellé + couleur, attachables à
 * plusieurs missions. Persistance serveur pour la cohérence multi-écrans
 * (board, fiche mission, filtres).
 */
export interface MissionTagView {
  id: Id;
  label: string;
  /** Couleur au format #RRGGBB. */
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTagInput {
  id: Id;
  label: string;
  color: string;
  context: CommandContext;
}

export interface UpdateTagInput {
  id: Id;
  label: string;
  color: string;
  context: CommandContext;
}

export interface SetMissionTagsInput {
  missionId: Id;
  tagIds: Id[];
  context: CommandContext;
}

export interface TagRepository {
  /** Tous les tags, triés par libellé. */
  list(): Promise<MissionTagView[]>;
  get(id: Id): Promise<MissionTagView | null>;
  /** Tag portant ce libellé exact (libellés uniques), null sinon. */
  findByLabel(label: string): Promise<MissionTagView | null>;
  create(input: CreateTagInput): Promise<MissionTagView>;
  /** Met à jour label + couleur. Retourne null si le tag n'existe pas. */
  update(input: UpdateTagInput): Promise<MissionTagView | null>;
  /** Supprime le tag et ses liaisons mission. Retourne false si inconnu. */
  delete(id: Id): Promise<boolean>;
  /** Tags d'une mission, triés par libellé. */
  tagsForMission(missionId: Id): Promise<MissionTagView[]>;
  /** Ids parmi `ids` qui n'existent pas (listes vides → []). */
  missingTagIds(ids: Id[]): Promise<Id[]>;
  /** Remplace l'ensemble des tags d'une mission (transactionnel). */
  setMissionTags(input: SetMissionTagsInput): Promise<void>;
}

/** Normalise un libellé de tag (trim + non vide). */
export function normalizeTagLabel(raw: string): string {
  const label = raw.trim();
  if (!label) throw new DomainError("Tag label is required", "TAG_LABEL_REQUIRED");
  return label;
}

/** Normalise une couleur de tag (#RRGGBB, minuscules). */
export function normalizeTagColor(raw: string): string {
  const color = raw.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) {
    throw new DomainError("Tag color must be #RRGGBB", "TAG_COLOR_INVALID");
  }
  return color;
}
