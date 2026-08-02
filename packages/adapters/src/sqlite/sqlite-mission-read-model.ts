import type {
  MissionAuditView,
  MissionListFilter,
  MissionReadModel,
  MissionRunView,
  MissionRunsView,
  MissionView,
  RelayMissionView,
  RelayProjection
} from "@nodra/application";
import { asId, type Id } from "@nodra/domain";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { missions } from "./schema/missions.js";
import { runs } from "./schema/runs.js";
import { conversationItems } from "./schema/conversations.js";
import { businessAuditEvents, relayItems } from "./schema/operations.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

type MissionRow = typeof missions.$inferSelect;

/** États de run où l'agent travaille encore (le live du board s'affiche pour ces runs). */
const ACTIVE_RUN_STATES = new Set(["QUEUED", "STARTING", "RUNNING", "WAITING_APPROVAL", "CANCELLING"]);

const toView = (row: MissionRow): Omit<MissionView, "runState" | "runStartedAt" | "lastAssistantMessage"> => ({
  id: asId(row.id),
  projectId: row.projectId ? asId(row.projectId) : null,
  title: row.title,
  executionKind: row.executionKind,
  state: row.state,
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});

const toRunView = (row: typeof runs.$inferSelect): MissionRunView => ({
  id: asId(row.id),
  attempt: row.userAttempt,
  state: row.state,
  providerId: row.providerId,
  modelId: row.modelId,
  startedAt: row.startedAt,
  endedAt: row.endedAt,
  durationMs: row.durationMs,
  inputTokens: row.inputTokens,
  outputTokens: row.outputTokens,
  cacheReadTokens: row.cacheReadTokens,
  cacheWriteTokens: row.cacheWriteTokens,
  costMicros: row.costMicros ?? null,
  usageKind: row.usageKind
});

interface LatestRunInfo {
  state: string | null;
  startedAt: string | null;
  lastAssistantMessage: string | null;
}

export class SqliteMissionReadModel implements MissionReadModel {
  constructor(private readonly database: NodraSqliteDatabase) {}

  /**
   * Dernier run de mission (tentative la plus récente) pour chaque mission,
   * plus le dernier message assistant du run s'il est encore actif.
   * Deux requêtes batch (une par mission via `inArray`), pas de N+1.
   */
  private latestRunInfoByMission(missionIds: string[]): Map<string, LatestRunInfo> {
    const uniqueIds = [...new Set(missionIds)];
    const info = new Map<string, LatestRunInfo>();
    if (uniqueIds.length === 0) return info;

    const runRows = this.database.orm.select()
      .from(runs)
      .where(inArray(runs.missionId, uniqueIds))
      .orderBy(desc(runs.userAttempt), desc(runs.createdAt))
      .all();
    const latest = new Map<string, { state: string; startedAt: string | null; conversationId: string }>();
    for (const row of runRows) {
      if (!row.missionId || latest.has(row.missionId)) continue;
      latest.set(row.missionId, { state: row.state, startedAt: row.startedAt, conversationId: row.conversationId });
    }

    // Chaque run a sa propre conversation : le dernier message assistant de la
    // conversation du run actif est bien le dernier message de ce run.
    const activeRunConversations = [...latest.values()]
      .filter((run) => ACTIVE_RUN_STATES.has(run.state))
      .map((run) => run.conversationId);
    const lastMessageByConversation = new Map<string, string>();
    if (activeRunConversations.length > 0) {
      const messageRows = this.database.orm.select({
        conversationId: conversationItems.conversationId,
        body: conversationItems.body
      })
        .from(conversationItems)
        .where(and(
          inArray(conversationItems.conversationId, activeRunConversations),
          eq(conversationItems.kind, "assistant")
        ))
        .orderBy(desc(conversationItems.createdAt), desc(conversationItems.ordinal))
        .all();
      for (const row of messageRows) {
        if (!row.body?.trim() || lastMessageByConversation.has(row.conversationId)) continue;
        lastMessageByConversation.set(row.conversationId, row.body);
      }
    }

    for (const [missionId, run] of latest) {
      info.set(missionId, {
        state: run.state,
        startedAt: run.startedAt,
        lastAssistantMessage: ACTIVE_RUN_STATES.has(run.state)
          ? lastMessageByConversation.get(run.conversationId) ?? null
          : null
      });
    }
    return info;
  }

  private withLatestRun(row: MissionRow, latest: LatestRunInfo | undefined): MissionView {
    return {
      ...toView(row),
      runState: latest?.state ?? null,
      runStartedAt: latest?.startedAt ?? null,
      lastAssistantMessage: latest?.lastAssistantMessage ?? null
    };
  }

  async list(filter?: MissionListFilter): Promise<MissionView[]> {
    try {
      const query = this.database.orm.select().from(missions).orderBy(asc(missions.createdAt), asc(missions.id));
      const rows = !filter || filter.projectId === undefined
        ? query.all()
        : query.where(filter.projectId === null ? isNull(missions.projectId) : eq(missions.projectId, filter.projectId)).all();
      const latest = this.latestRunInfoByMission(rows.map((row) => row.id));
      return rows.map((row) => this.withLatestRun(row, latest.get(row.id)));
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async show(id: Id): Promise<MissionView | null> {
    try {
      const row = this.database.orm.select().from(missions).where(eq(missions.id, id)).get();
      if (!row) return null;
      return this.withLatestRun(row, this.latestRunInfoByMission([id]).get(id));
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async runs(id: Id): Promise<MissionRunsView> {
    try {
      const rows = this.database.orm.select()
        .from(runs)
        .where(eq(runs.missionId, id))
        .orderBy(asc(runs.userAttempt), asc(runs.createdAt))
        .all();
      const runViews = rows.map(toRunView);
      const knownCosts = runViews
        .map((run) => run.costMicros)
        .filter((value): value is number => value !== null);
      return {
        runs: runViews,
        totalCostMicros: knownCosts.length > 0
          ? knownCosts.reduce((sum, value) => sum + value, 0)
          : null
      };
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async relay(filter?: MissionListFilter): Promise<RelayProjection> {
    try {
      const rows = this.database.orm
        .select({ mission: missions, reasonCode: relayItems.reasonCode, queue: relayItems.queue })
        .from(relayItems)
        .innerJoin(missions, eq(relayItems.missionId, missions.id))
        .orderBy(asc(relayItems.createdAt), asc(relayItems.id))
        .all();
      const projection: RelayProjection = { ready: [], active: [], blocked: [], decision_required: [] };
      const latest = this.latestRunInfoByMission(rows.map((row) => row.mission.id));
      for (const row of rows) {
        if (filter && filter.projectId !== undefined && row.mission.projectId !== filter.projectId) continue;
        const item: RelayMissionView = { ...this.withLatestRun(row.mission, latest.get(row.mission.id)), reasonCode: row.reasonCode };
        projection[row.queue].push(item);
      }
      return projection;
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  /**
   * Timeline d'audit de la mission : tous les événements persistés atomiquement
   * avec les sauvegardes d'agrégat (transitions d'état, décisions, commandes),
   * du plus ancien au plus récent.
   */
  async audit(id: Id): Promise<MissionAuditView[]> {
    try {
      const rows = this.database.orm.select()
        .from(businessAuditEvents)
        .where(and(
          eq(businessAuditEvents.aggregateKind, "mission"),
          eq(businessAuditEvents.aggregateId, id)
        ))
        .orderBy(asc(businessAuditEvents.occurredAt), asc(businessAuditEvents.id))
        .all();
      return rows.map((row) => ({
        id: asId(row.id),
        commandId: asId(row.commandId ?? row.id),
        eventType: row.eventType,
        actor: row.actor as "user" | "manager",
        payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
        occurredAt: row.occurredAt
      }));
    } catch (error) {
      throw translateSqliteError(error);
    }
  }
}
