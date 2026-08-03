import type {
  CreateTagInput,
  MissionTagView,
  SetMissionTagsInput,
  TagRepository,
  UpdateTagInput
} from "@nodra/application";
import { asId, DomainError, type Id } from "@nodra/domain";
import { asc, eq, inArray } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { businessAuditEvents } from "./schema/operations.js";
import { missionTags, tags } from "./schema/tags.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

type TagRow = typeof tags.$inferSelect;

const toView = (row: TagRow): MissionTagView => ({
  id: asId(row.id),
  label: row.label,
  color: row.color,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});

/**
 * Tags libres des missions (issue #23) : CRUD des tags + liaisons mission.
 * Chaque mutation écrit aussi un événement d'audit (agrégat "tag" pour le
 * CRUD, agrégat "mission" pour la liaison — visible dans la timeline mission).
 */
export class SqliteTagRepository implements TagRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async list(): Promise<MissionTagView[]> {
    try {
      return this.database.orm.select().from(tags).orderBy(asc(tags.label)).all().map(toView);
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async get(id: Id): Promise<MissionTagView | null> {
    try {
      const row = this.database.orm.select().from(tags).where(eq(tags.id, id)).get();
      return row ? toView(row) : null;
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async findByLabel(label: string): Promise<MissionTagView | null> {
    try {
      const row = this.database.orm.select().from(tags).where(eq(tags.label, label)).get();
      return row ? toView(row) : null;
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async create(input: CreateTagInput): Promise<MissionTagView> {
    try {
      const row: TagRow = {
        id: input.id,
        label: input.label,
        color: input.color,
        createdAt: input.context.occurredAt,
        updatedAt: input.context.occurredAt
      };
      this.database.orm.transaction((transaction) => {
        transaction.insert(tags).values(row).run();
        transaction.insert(businessAuditEvents).values({
          id: asId(`audit/${input.context.commandId}`),
          aggregateKind: "tag",
          aggregateId: input.id,
          commandId: input.context.commandId,
          eventType: "TAG_CREATED",
          actor: input.context.actor,
          payloadJson: JSON.stringify({ label: input.label, color: input.color }),
          occurredAt: input.context.occurredAt
        }).run();
      });
      return toView(row);
    } catch (error) {
      throw this.translateTagError(error);
    }
  }

  async update(input: UpdateTagInput): Promise<MissionTagView | null> {
    try {
      return this.database.orm.transaction((transaction) => {
        const existing = transaction.select().from(tags).where(eq(tags.id, input.id)).get();
        if (!existing) return null;
        transaction.update(tags).set({ label: input.label, color: input.color, updatedAt: input.context.occurredAt })
          .where(eq(tags.id, input.id)).run();
        transaction.insert(businessAuditEvents).values({
          id: asId(`audit/${input.context.commandId}`),
          aggregateKind: "tag",
          aggregateId: input.id,
          commandId: input.context.commandId,
          eventType: "TAG_UPDATED",
          actor: input.context.actor,
          payloadJson: JSON.stringify({ label: input.label, color: input.color }),
          occurredAt: input.context.occurredAt
        }).run();
        return toView({ ...existing, label: input.label, color: input.color, updatedAt: input.context.occurredAt });
      });
    } catch (error) {
      throw this.translateTagError(error);
    }
  }

  async delete(id: Id): Promise<boolean> {
    try {
      return this.database.orm.transaction((transaction) => {
        const existing = transaction.select({ id: tags.id }).from(tags).where(eq(tags.id, id)).get();
        if (!existing) return false;
        transaction.delete(missionTags).where(eq(missionTags.tagId, id)).run();
        transaction.delete(tags).where(eq(tags.id, id)).run();
        transaction.insert(businessAuditEvents).values({
          id: asId(`audit/${id}/deleted`),
          aggregateKind: "tag",
          aggregateId: id,
          commandId: id,
          eventType: "TAG_DELETED",
          actor: "user",
          payloadJson: JSON.stringify({}),
          occurredAt: new Date().toISOString()
        }).run();
        return true;
      });
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async tagsForMission(missionId: Id): Promise<MissionTagView[]> {
    try {
      const rows = this.database.orm.select({ tag: tags })
        .from(missionTags)
        .innerJoin(tags, eq(missionTags.tagId, tags.id))
        .where(eq(missionTags.missionId, missionId))
        .orderBy(asc(tags.label))
        .all();
      return rows.map((row) => toView(row.tag));
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async missingTagIds(ids: Id[]): Promise<Id[]> {
    try {
      const unique = [...new Set(ids)];
      if (unique.length === 0) return [];
      const rows = this.database.orm.select({ id: tags.id }).from(tags).where(inArray(tags.id, unique)).all();
      const found = new Set(rows.map((row) => row.id));
      return unique.filter((id) => !found.has(id));
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async setMissionTags(input: SetMissionTagsInput): Promise<void> {
    try {
      this.database.orm.transaction((transaction) => {
        transaction.delete(missionTags).where(eq(missionTags.missionId, input.missionId)).run();
        if (input.tagIds.length > 0) {
          transaction.insert(missionTags).values(
            input.tagIds.map((tagId) => ({ missionId: input.missionId, tagId, createdAt: input.context.occurredAt }))
          ).run();
        }
        transaction.insert(businessAuditEvents).values({
          id: asId(`audit/${input.context.commandId}`),
          aggregateKind: "mission",
          aggregateId: input.missionId,
          commandId: input.context.commandId,
          eventType: "MISSION_TAGS_UPDATED",
          actor: input.context.actor,
          payloadJson: JSON.stringify({ tagIds: input.tagIds }),
          occurredAt: input.context.occurredAt
        }).run();
      });
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  /** Violation d'unicité du libellé (SQLITE_CONSTRAINT_UNIQUE) → TAG_ALREADY_EXISTS. */
  private translateTagError(error: unknown): DomainError {
    if (error instanceof DomainError) return error;
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: tag.label")) {
      return new DomainError("A tag with this label already exists", "TAG_ALREADY_EXISTS");
    }
    return translateSqliteError(error);
  }
}
