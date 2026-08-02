import type {
  MissionListFilter,
  MissionReadModel,
  MissionRunView,
  MissionRunsView,
  MissionView,
  RelayMissionView,
  RelayProjection
} from "@nodra/application";
import { asId, type Id } from "@nodra/domain";
import { asc, eq, isNull } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { missions } from "./schema/missions.js";
import { runs } from "./schema/runs.js";
import { relayItems } from "./schema/operations.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

type MissionRow = typeof missions.$inferSelect;

const toView = (row: MissionRow): MissionView => ({
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

export class SqliteMissionReadModel implements MissionReadModel {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async list(filter?: MissionListFilter): Promise<MissionView[]> {
    try {
      const query = this.database.orm.select().from(missions).orderBy(asc(missions.createdAt), asc(missions.id));
      if (!filter || filter.projectId === undefined) return query.all().map(toView);
      return query.where(filter.projectId === null ? isNull(missions.projectId) : eq(missions.projectId, filter.projectId)).all().map(toView);
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async show(id: Id): Promise<MissionView | null> {
    try {
      const row = this.database.orm.select().from(missions).where(eq(missions.id, id)).get();
      return row ? toView(row) : null;
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
      for (const row of rows) {
        if (filter && filter.projectId !== undefined && row.mission.projectId !== filter.projectId) continue;
        const item: RelayMissionView = { ...toView(row.mission), reasonCode: row.reasonCode };
        projection[row.queue].push(item);
      }
      return projection;
    } catch (error) {
      throw translateSqliteError(error);
    }
  }
}
