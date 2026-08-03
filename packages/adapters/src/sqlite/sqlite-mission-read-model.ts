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
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { missions } from "./schema/missions.js";
import { runs } from "./schema/runs.js";
import { conversationItems } from "./schema/conversations.js";
import { gateBindings, gateDefinitions, gateEvaluations } from "./schema/gates.js";
import { businessAuditEvents, relayItems } from "./schema/operations.js";
import { providerEvents } from "./schema/provider-events.js";
import { runConfigSnapshots } from "./schema/runs.js";
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
  usageKind: row.usageKind,
  reasoningEffort: row.reasoningEffort,
  promptEffective: null,
  permissionPreset: null,
  providerOptions: null,
  events: [],
  gates: []
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
      const runIds = rows.map((row) => row.id);
      if (runIds.length > 0) {
        const snapshots = this.database.orm.select().from(runConfigSnapshots)
          .where(inArray(runConfigSnapshots.runId, runIds)).all();
        const snapshotByRun = new Map(snapshots.map((snapshot) => [snapshot.runId, snapshot]));
        const eventsByRun = new Map<string, MissionRunView["events"]>();
        for (const event of this.database.orm.select().from(providerEvents)
          .where(inArray(providerEvents.runId, runIds)).orderBy(asc(providerEvents.runId), asc(providerEvents.sequence)).all()) {
          const events = eventsByRun.get(event.runId) ?? [];
          events.push({
            sequence: event.sequence,
            type: event.type,
            payload: JSON.parse(event.payloadJson) as unknown,
            sourceAt: event.sourceAt,
            receivedAt: event.receivedAt
          });
          eventsByRun.set(event.runId, events);
        }
        const gatesByRun = new Map<string, MissionRunView["gates"]>();
        const latestGateByRunBinding = new Set<string>();
        const gateRows = this.database.orm.select({ evaluation: gateEvaluations, definition: gateDefinitions })
          .from(gateEvaluations)
          .innerJoin(gateBindings, eq(gateBindings.id, gateEvaluations.gateBindingId))
          .innerJoin(gateDefinitions, eq(gateDefinitions.id, gateBindings.gateId))
          .where(inArray(gateEvaluations.runId, runIds))
          .orderBy(asc(gateEvaluations.runId), asc(gateEvaluations.gateBindingId), desc(gateEvaluations.evaluatedAt), desc(gateEvaluations.id))
          .all();
        for (const row of gateRows) {
          if (!row.evaluation.runId) continue;
          const key = `${row.evaluation.runId}/${row.evaluation.gateBindingId}`;
          if (latestGateByRunBinding.has(key)) continue;
          latestGateByRunBinding.add(key);
          const gates = gatesByRun.get(row.evaluation.runId) ?? [];
          gates.push({ name: row.definition.name, state: row.evaluation.state, rationale: row.evaluation.rationale, evaluatedAt: row.evaluation.evaluatedAt });
          gatesByRun.set(row.evaluation.runId, gates);
        }
        for (const run of runViews) {
          const snapshot = snapshotByRun.get(run.id);
          run.promptEffective = snapshot?.promptEffective ?? null;
          run.permissionPreset = snapshot?.permissionPreset ?? null;
          run.providerOptions = snapshot ? JSON.parse(snapshot.providerOptionsJson) as unknown : null;
          run.events = eventsByRun.get(run.id) ?? [];
          run.gates = gatesByRun.get(run.id) ?? [];
        }
      }
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
   * avec les sauvegardes d'agrégat, du plus ancien au plus récent.
   *
   * Couvre trois périmètres liés à la mission :
   * - les événements d'agrégat mission (`aggregateKind="mission"` : transitions
   *   d'état, activation de config, démarrage de run…) ;
   * - les événements des runs de la mission (`aggregateKind="run"` : delivery
   *   déclarée, décisions humaines accept/request-changes/reject, fin de run,
   *   preuves collectées) ;
   * - les évaluations de gates liées à la mission (`aggregateKind="gate_evaluation"` :
   *   gates attachées à la mission ou évaluées pendant un de ses runs).
   */
  async audit(id: Id): Promise<MissionAuditView[]> {
    try {
      const runIds = this.database.orm.select({ id: runs.id })
        .from(runs)
        .where(eq(runs.missionId, id))
        .all()
        .map((row) => row.id);
      const gateBindingIds = this.database.orm.select({ id: gateBindings.id })
        .from(gateBindings)
        .where(eq(gateBindings.missionId, id))
        .all()
        .map((row) => row.id);
      const gateEvaluationIds = (gateBindingIds.length > 0 || runIds.length > 0)
        ? this.database.orm.select({ id: gateEvaluations.id })
          .from(gateEvaluations)
          .where(or(
            ...(gateBindingIds.length > 0 ? [inArray(gateEvaluations.gateBindingId, gateBindingIds)] : []),
            ...(runIds.length > 0 ? [inArray(gateEvaluations.runId, runIds)] : [])
          ))
          .all()
          .map((row) => row.id)
        : [];

      const conditions = [
        and(
          eq(businessAuditEvents.aggregateKind, "mission"),
          eq(businessAuditEvents.aggregateId, id)
        ),
        ...(runIds.length > 0
          ? [and(
            eq(businessAuditEvents.aggregateKind, "run"),
            inArray(businessAuditEvents.aggregateId, runIds)
          )]
          : []),
        ...(gateEvaluationIds.length > 0
          ? [and(
            eq(businessAuditEvents.aggregateKind, "gate_evaluation"),
            inArray(businessAuditEvents.aggregateId, gateEvaluationIds)
          )]
          : [])
      ];
      const rows = this.database.orm.select()
        .from(businessAuditEvents)
        .where(or(...conditions))
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
