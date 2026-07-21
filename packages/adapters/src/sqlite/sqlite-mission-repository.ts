import type { MissionRepository, SaveMissionInput } from "@nodra/application";
import { asId, DomainError, Mission, type Id } from "@nodra/domain";
import { and, eq } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { missions } from "./schema/missions.js";
import { businessAuditEvents, outbox, relayItems } from "./schema/operations.js";

export class SqliteMissionRepository implements MissionRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async load(id: Id): Promise<Mission | null> {
    const row = this.database.orm.select().from(missions).where(eq(missions.id, id)).get();
    if (!row) return null;
    return Mission.rehydrate({
      id: asId(row.id),
      projectId: row.projectId ? asId(row.projectId) : null,
      title: row.title,
      executionKind: row.executionKind,
      state: row.state,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    });
  }

  async save(input: SaveMissionInput): Promise<void> {
    const snapshot = input.mission.snapshot();
    this.database.orm.transaction((transaction) => {
      if (input.expectedVersion === -1) {
        transaction.insert(missions).values({ ...snapshot, projectId: snapshot.projectId }).run();
      } else {
        const result = transaction
          .update(missions)
          .set({
            projectId: snapshot.projectId,
            title: snapshot.title,
            executionKind: snapshot.executionKind,
            state: snapshot.state,
            version: snapshot.version,
            updatedAt: snapshot.updatedAt
          })
          .where(and(eq(missions.id, snapshot.id), eq(missions.version, input.expectedVersion)))
          .run();
        if (result.changes !== 1) {
          throw new DomainError("Mission version conflict", "MISSION_VERSION_CONFLICT");
        }
      }

      if (input.relay) {
        transaction
          .insert(relayItems)
          .values({
            id: input.relay.id,
            missionId: snapshot.id,
            pipelineRunId: null,
            queue: input.relay.queue,
            state: "unread",
            reasonCode: input.relay.reasonCode,
            createdAt: input.relay.createdAt
          })
          .onConflictDoUpdate({
            target: relayItems.id,
            set: {
              queue: input.relay.queue,
              state: "unread",
              reasonCode: input.relay.reasonCode,
              createdAt: input.relay.createdAt,
              readAt: null,
              snoozedUntil: null,
              resolvedAt: null
            }
          })
          .run();
      } else {
        transaction.delete(relayItems).where(eq(relayItems.missionId, snapshot.id)).run();
      }

      transaction
        .insert(businessAuditEvents)
        .values({
          id: input.audit.id,
          aggregateKind: "mission",
          aggregateId: snapshot.id,
          commandId: input.audit.commandId,
          eventType: input.audit.eventType,
          actor: input.audit.actor,
          payloadJson: JSON.stringify(input.audit.payload),
          occurredAt: input.audit.occurredAt
        })
        .run();
      transaction
        .insert(outbox)
        .values({
          id: input.outbox.id,
          kind: input.outbox.kind,
          aggregateId: snapshot.id,
          payloadJson: JSON.stringify(input.outbox.payload),
          dedupeKey: input.outbox.dedupeKey,
          createdAt: input.outbox.createdAt,
          publishedAt: null
        })
        .run();
    });
  }
}
