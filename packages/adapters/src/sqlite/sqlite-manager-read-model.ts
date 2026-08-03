import type {
  ManagerConversationView,
  ManagerListFilter,
  ManagerReadModel,
  ManagerTimelineFilter,
  ManagerTimelineItemKind,
  ManagerTimelineView,
  ManagerView
} from "@nodra/application";
import { asId, type Id } from "@nodra/domain";
import { and, desc, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { conversationItems, conversations } from "./schema/conversations.js";
import { workspaces } from "./schema/core.js";
import { managerInstructionVersions, managers } from "./schema/managers.js";
import { runs } from "./schema/runs.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

const ACTIVE_RUN_STATES = ["QUEUED", "STARTING", "RUNNING", "WAITING_APPROVAL", "CANCELLING"] as const;

export class SqliteManagerReadModel implements ManagerReadModel {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async list(filter?: ManagerListFilter): Promise<ManagerView[]> {
    try {
      const rows = this.database.orm.select().from(managers).all();
      return rows
        .filter((row) => (filter?.includeArchived ? true : row.state !== "archived"))
        .filter((row) => (filter?.projectId ? row.projectId === filter.projectId : true))
        .map((row) => this.view(asId(row.id)))
        .filter((view): view is ManagerView => view !== null)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async show(id: Id): Promise<ManagerView | null> {
    try {
      return this.view(id);
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async conversations(id: Id): Promise<ManagerConversationView[]> {
    try {
      const rows = this.database.orm
        .select()
        .from(conversations)
        .where(and(eq(conversations.managerId, id), ne(conversations.state, "deleted")))
        .orderBy(desc(conversations.createdAt))
        .all();
      return rows.map((conversation, index) => {
        const turns = this.database.orm
          .select({
            runId: runs.id,
            state: runs.state,
            createdAt: runs.createdAt,
            endedAt: runs.endedAt
          })
          .from(runs)
          .where(eq(runs.conversationId, conversation.id))
          .orderBy(runs.createdAt)
          .all();
        const summary = this.database.orm
          .select({ body: conversationItems.body })
          .from(conversationItems)
          .where(and(eq(conversationItems.conversationId, conversation.id), eq(conversationItems.kind, "user")))
          .orderBy(conversationItems.ordinal)
          .limit(1)
          .get();
        return {
          id: conversation.id,
          managerId: id,
          createdAt: conversation.createdAt,
          current: index === 0,
          providerSessionRef: conversation.providerSessionRef,
          threadId: conversation.id,
          turns: turns.map((turn) => ({
            runId: turn.runId,
            state: turn.state,
            createdAt: turn.createdAt,
            endedAt: turn.endedAt,
            summary: summary?.body ?? null
          }))
        };
      });
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async timeline(filter: ManagerTimelineFilter): Promise<ManagerTimelineView> {
    try {
      const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500);
      const conditions = [
        isNotNull(conversations.managerId),
        ne(conversations.state, "deleted")
      ];
      if (filter.managerId) conditions.push(eq(conversations.managerId, filter.managerId));
      if (filter.missionId) {
        conditions.push(sql`${conversationItems.body} like ${`%${filter.missionId}%`}`);
      }
      if (filter.query?.trim()) {
        const escaped = filter.query.replace(/[\\%_]/g, "\\$&");
        conditions.push(sql`${conversationItems.body} like ${`%${escaped}%`} escape '\\'`);
      }
      if (filter.since) conditions.push(gte(conversationItems.createdAt, filter.since));
      if (filter.until) conditions.push(lte(conversationItems.createdAt, filter.until));

      const rows = this.database.orm
        .select({
          id: conversationItems.id,
          conversationId: conversationItems.conversationId,
          managerId: managers.id,
          managerName: managers.name,
          managerState: managers.state,
          kind: conversationItems.kind,
          body: conversationItems.body,
          createdAt: conversationItems.createdAt
        })
        .from(conversationItems)
        .innerJoin(conversations, eq(conversationItems.conversationId, conversations.id))
        .innerJoin(managers, eq(conversations.managerId, managers.id))
        .where(and(...conditions))
        .orderBy(desc(conversationItems.createdAt))
        .limit(limit + 1)
        .all();
      const truncated = rows.length > limit;
      return {
        truncated,
        items: rows.slice(0, limit).map((row) => ({
          id: row.id,
          conversationId: row.conversationId,
          managerId: row.managerId,
          managerName: row.managerName ?? "",
          managerState: row.managerState,
          kind: row.kind as ManagerTimelineItemKind,
          body: row.body,
          createdAt: row.createdAt
        }))
      };
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  private view(id: Id): ManagerView | null {
    const row = this.database.orm.select().from(managers).where(eq(managers.id, id)).get();
    if (!row) return null;
    const instruction = this.database.orm
      .select({ instruction: managerInstructionVersions.instruction, updatedAt: managerInstructionVersions.createdAt })
      .from(managerInstructionVersions)
      .where(and(eq(managerInstructionVersions.managerId, id), eq(managerInstructionVersions.isCurrent, 1)))
      .get();
    const workspacePath = row.workspaceId
      ? this.database.orm.select({ path: workspaces.path }).from(workspaces).where(eq(workspaces.id, row.workspaceId)).get()?.path ?? null
      : null;
    const managerConversations = this.database.orm
      .select({ id: conversations.id, createdAt: conversations.createdAt })
      .from(conversations)
      .where(and(eq(conversations.managerId, id), ne(conversations.state, "deleted")))
      .orderBy(desc(conversations.createdAt))
      .all();
    const conversationIds = managerConversations.map((conversation) => conversation.id);
    const activeRun = this.database.orm
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.managerId, id), inArray(runs.state, [...ACTIVE_RUN_STATES])))
      .orderBy(desc(runs.createdAt))
      .limit(1)
      .get();
    const lastMessage = conversationIds.length
      ? this.database.orm
          .select({ body: conversationItems.body })
          .from(conversationItems)
          .where(and(inArray(conversationItems.conversationId, conversationIds), eq(conversationItems.kind, "assistant")))
          .orderBy(desc(conversationItems.createdAt))
          .limit(1)
          .get()
      : undefined;
    return {
      id,
      projectId: row.projectId ? asId(row.projectId) : null,
      name: row.name ?? "",
      instruction: instruction?.instruction ?? "",
      state: row.state,
      providerId: row.providerId,
      modelId: row.modelId,
      reasoningEffort: row.reasoningEffort,
      permissionPreset: row.permissionPreset,
      workspaceId: row.workspaceId ? asId(row.workspaceId) : null,
      workspacePath,
      createdAt: row.createdAt,
      updatedAt: instruction?.updatedAt ?? row.createdAt,
      archivedAt: row.archivedAt,
      activeRunId: activeRun?.id ?? null,
      currentThreadId: conversationIds[0] ?? null,
      lastMessage: lastMessage?.body ?? null,
      conversationCount: conversationIds.length
    };
  }
}
