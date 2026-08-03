import type { ActivityItemView, ActivityRepository, ActivityView } from "@nodra/application";
import { asId, type Id } from "@nodra/domain";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { missions } from "./schema/missions.js";
import { pipelineRuns, pipelines } from "./schema/pipelines.js";
import { relayItems } from "./schema/operations.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

/**
 * Hub d'activité : lit les items du relay qui attendent une décision humaine
 * (queues `blocked` et `decision_required`, hors items résolus) et permet de
 * les marquer comme lus. Le relay est la source de vérité du projet pour ces
 * queues (écrit par les repositories mission/pipeline/approval/delivery).
 */
export class SqliteActivityRepository implements ActivityRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async list(): Promise<ActivityView> {
    try {
      const rows = this.database.orm
        .select({
          relayId: relayItems.id,
          queue: relayItems.queue,
          state: relayItems.state,
          reasonCode: relayItems.reasonCode,
          createdAt: relayItems.createdAt,
          readAt: relayItems.readAt,
          missionId: missions.id,
          missionTitle: missions.title,
          missionKind: missions.executionKind,
          missionState: missions.state,
          missionUpdatedAt: missions.updatedAt,
          pipelineRunId: pipelineRuns.id,
          pipelineId: pipelines.id,
          pipelineName: pipelines.name
        })
        .from(relayItems)
        .leftJoin(missions, eq(relayItems.missionId, missions.id))
        .leftJoin(pipelineRuns, eq(relayItems.pipelineRunId, pipelineRuns.id))
        .leftJoin(pipelines, eq(pipelineRuns.pipelineId, pipelines.id))
        .where(and(
          inArray(relayItems.queue, ["blocked", "decision_required"]),
          ne(relayItems.state, "resolved")
        ))
        .orderBy(desc(relayItems.createdAt), desc(relayItems.id))
        .all();

      const items: ActivityItemView[] = rows.map((row) => ({
        relayId: asId(row.relayId),
        // Le WHERE restreint déjà queue ∈ (blocked, decision_required) et state ≠ resolved.
        queue: row.queue as ActivityItemView["queue"],
        state: row.state as ActivityItemView["state"],
        reasonCode: row.reasonCode,
        createdAt: row.createdAt,
        readAt: row.readAt,
        subject: row.missionId !== null
          ? {
              kind: "mission",
              mission: {
                id: asId(row.missionId),
                title: row.missionTitle ?? "",
                executionKind: row.missionKind!,
                state: row.missionState!,
                updatedAt: row.missionUpdatedAt ?? ""
              }
            }
          : {
              kind: "pipeline",
              pipelineId: asId(row.pipelineId ?? row.relayId),
              pipelineName: row.pipelineName ?? row.relayId
            }
      }));

      return { items, unreadCount: items.filter((item) => item.state === "unread").length };
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async markRead(relayId: Id, readAt: string): Promise<boolean> {
    try {
      const result = this.database.orm
        .update(relayItems)
        .set({ state: "read", readAt })
        .where(and(eq(relayItems.id, relayId), ne(relayItems.state, "resolved")))
        .run();
      return result.changes === 1;
    } catch (error) {
      throw translateSqliteError(error);
    }
  }
}
