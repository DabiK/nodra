import type { PendingWorkflowStart, WorkflowOutboxStore } from "@nodra/application";
import { asId, DomainError } from "@nodra/domain";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { outbox } from "./schema/operations.js";
import { runs } from "./schema/runs.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

interface StartPayload {
  schemaVersion: 1;
  missionId?: string;
  managerId?: string;
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
        .where(and(inArray(outbox.kind, ["workflow.mission.start", "workflow.manager.start"]), isNull(outbox.publishedAt)))
        .orderBy(asc(outbox.createdAt), asc(outbox.id))
        .limit(limit)
        .all();
      return rows.map((row) => {
        const manager = row.kind === "workflow.manager.start";
        const payload = this.parsePayload(row.payloadJson, manager);
        this.validateIdentity(payload, row.dedupeKey, manager);
        return {
          id: asId(row.id),
          dedupeKey: row.dedupeKey,
          input: manager
            ? {
                managerId: asId(payload.managerId!),
                subjectKind: "manager" as const,
                commandId: asId(payload.commandId),
                runId: asId(payload.runId),
                schemaVersion: 1 as const,
                executeProvider: payload.executeProvider === true
              }
            : {
                missionId: asId(payload.missionId!),
                subjectKind: "mission" as const,
                commandId: asId(payload.commandId),
                runId: asId(payload.runId),
                schemaVersion: 1 as const,
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

  private parsePayload(value: string, manager: boolean): StartPayload {
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
    const subjectId = manager ? candidate.managerId : candidate.missionId;
    if (
      candidate.schemaVersion !== 1 ||
      typeof subjectId !== "string" || subjectId.trim() === "" ||
      typeof candidate.commandId !== "string" || candidate.commandId.trim() === "" ||
      typeof candidate.runId !== "string" || candidate.runId.trim() === "" ||
      (candidate.executeProvider !== undefined && typeof candidate.executeProvider !== "boolean")
    ) {
      throw new DomainError("Workflow outbox payload is unsupported", "OUTBOX_PAYLOAD_INVALID");
    }
    return candidate as unknown as StartPayload;
  }

  private validateIdentity(payload: StartPayload, dedupeKey: string, manager: boolean): void {
    const subjectId = manager ? payload.managerId! : payload.missionId!;
    const prefix = manager ? "manager" : "mission";
    if (dedupeKey !== `${prefix}/${subjectId}/run/${payload.runId}`) {
      throw new DomainError("Workflow outbox identity is inconsistent", "OUTBOX_PAYLOAD_INVALID");
    }
    const run = this.database.orm
      .select({ id: runs.id })
      .from(runs)
      .where(and(
        eq(runs.id, payload.runId),
        manager ? eq(runs.managerId, subjectId) : eq(runs.missionId, subjectId),
        eq(runs.temporalWorkflowId, `run/${payload.runId}`)
      ))
      .get();
    if (!run) throw new DomainError("Workflow outbox run identity is invalid", "OUTBOX_PAYLOAD_INVALID");
  }
}
