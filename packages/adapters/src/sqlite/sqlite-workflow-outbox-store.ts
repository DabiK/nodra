import type { PendingWorkflowStart, WorkflowOutboxStore } from "@nodra/application";
import { asId, DomainError } from "@nodra/domain";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { outbox } from "./schema/operations.js";
import { runs } from "./schema/runs.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

interface StartPayload {
  schemaVersion: 1;
  missionId: string;
  commandId: string;
  runId: string;
  executeProvider?: boolean;
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
        this.validateIdentity(payload, row.dedupeKey);
        return {
          id: asId(row.id),
          dedupeKey: row.dedupeKey,
          input: {
            missionId: asId(payload.missionId),
            commandId: asId(payload.commandId),
            runId: asId(payload.runId),
            schemaVersion: 1,
            executeProvider: payload.executeProvider === true
          }
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
    if (
      candidate.schemaVersion !== 1 ||
      typeof candidate.missionId !== "string" || candidate.missionId.trim() === "" ||
      typeof candidate.commandId !== "string" || candidate.commandId.trim() === "" ||
      typeof candidate.runId !== "string" || candidate.runId.trim() === "" ||
      (candidate.executeProvider !== undefined && typeof candidate.executeProvider !== "boolean")
    ) {
      throw new DomainError("Workflow outbox payload is unsupported", "OUTBOX_PAYLOAD_INVALID");
    }
    return candidate as unknown as StartPayload;
  }

  private validateIdentity(payload: StartPayload, dedupeKey: string): void {
    if (dedupeKey !== `mission/${payload.missionId}/run/${payload.runId}`) {
      throw new DomainError("Workflow outbox identity is inconsistent", "OUTBOX_PAYLOAD_INVALID");
    }
    const run = this.database.orm
      .select({ id: runs.id })
      .from(runs)
      .where(and(
        eq(runs.id, payload.runId),
        eq(runs.missionId, payload.missionId),
        eq(runs.temporalWorkflowId, `run/${payload.runId}`)
      ))
      .get();
    if (!run) throw new DomainError("Workflow outbox run identity is invalid", "OUTBOX_PAYLOAD_INVALID");
  }
}
