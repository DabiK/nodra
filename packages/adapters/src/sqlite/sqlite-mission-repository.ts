import type { MissionRepository, SaveMissionInput } from "@nodra/application";
import { asId, DomainError, Mission, type Id } from "@nodra/domain";
import { and, eq } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { projects } from "./schema/core.js";
import { missions } from "./schema/missions.js";
import { businessAuditEvents, outbox, relayItems } from "./schema/operations.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

export class SqliteMissionRepository implements MissionRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async load(id: Id): Promise<Mission | null> {
    try {
      const row = this.database.orm.select().from(missions).where(eq(missions.id, id)).get();
      if (!row) return null;
      return Mission.rehydrate({
        id: asId(row.id),
        projectId: row.projectId ? asId(row.projectId) : null,
        title: row.title,
        description: row.description,
        executionKind: row.executionKind,
        state: row.state,
        version: row.version,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      });
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async save(input: SaveMissionInput): Promise<void> {
    const snapshot = input.mission.snapshot();
    try {
      this.database.orm.transaction((transaction) => {
        if (snapshot.projectId) {
          const project = transaction.select({ id: projects.id }).from(projects).where(eq(projects.id, snapshot.projectId)).get();
          if (!project) throw new DomainError(`Project ${snapshot.projectId} was not found`, "PROJECT_NOT_FOUND");
        }

        if (input.expectedVersion === -1) {
          const existingMission = transaction.select({ id: missions.id }).from(missions).where(eq(missions.id, snapshot.id)).get();
          if (existingMission) throw new DomainError(`Mission ${snapshot.id} already exists`, "MISSION_ALREADY_EXISTS");
          transaction.insert(missions).values({ ...snapshot, description: snapshot.description ?? "", projectId: snapshot.projectId }).run();
        } else {
          const result = transaction
            .update(missions)
            .set({
              projectId: snapshot.projectId,
              title: snapshot.title,
              description: snapshot.description ?? "",
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

        const consumedCommand = transaction
          .select({ id: businessAuditEvents.id })
          .from(businessAuditEvents)
          .where(eq(businessAuditEvents.commandId, input.audit.commandId))
          .get();
        if (consumedCommand) {
          throw new DomainError(`Command ${input.audit.commandId} was already processed`, "COMMAND_ID_CONFLICT");
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
    } catch (error) {
      throw translateSqliteError(error);
    }
  }
}
