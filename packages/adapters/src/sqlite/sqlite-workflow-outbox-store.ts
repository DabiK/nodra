import type { PendingWorkflowStart, WorkflowOutboxStore } from "@nodra/application";
import { asId, DomainError } from "@nodra/domain";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { outbox } from "./schema/operations.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

interface StartPayload {
  schemaVersion: 1;
  missionId: string;
  commandId: string;
}

export class SqliteWorkflowOutboxStore implements WorkflowOutboxStore {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async listPendingStarts(limit: number): Promise<PendingWorkflowStart[]> {
    try {
      const rows = this.database.orm
        .select()
        .from(outbox)
        .where(and(eq(outbox.kind, "workflow.mission.start"), isNull(outbox.publishedAt)))
        .orderBy(asc(outbox.createdAt), asc(outbox.id))
        .limit(limit)
        .all();
      return rows.map((row) => {
        const payload = this.parsePayload(row.payloadJson);
        return {
          id: asId(row.id),
          dedupeKey: row.dedupeKey,
          input: { missionId: asId(payload.missionId), commandId: asId(payload.commandId), schemaVersion: 1 }
        };
      });
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async markPublished(id: ReturnType<typeof asId>, publishedAt: string): Promise<void> {
    try {
      this.database.orm
        .update(outbox)
        .set({ publishedAt })
        .where(and(eq(outbox.id, id), isNull(outbox.publishedAt)))
        .run();
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  private parsePayload(value: string): StartPayload {
    let payload: unknown;
    try {
      payload = JSON.parse(value);
    } catch {
      throw new DomainError("Workflow outbox payload is invalid", "OUTBOX_PAYLOAD_INVALID");
    }
    if (!payload || typeof payload !== "object") {
      throw new DomainError("Workflow outbox payload is invalid", "OUTBOX_PAYLOAD_INVALID");
    }
    const candidate = payload as Record<string, unknown>;
    if (candidate.schemaVersion !== 1 || typeof candidate.missionId !== "string" || typeof candidate.commandId !== "string") {
      throw new DomainError("Workflow outbox payload is unsupported", "OUTBOX_PAYLOAD_INVALID");
    }
    return candidate as unknown as StartPayload;
  }
}
