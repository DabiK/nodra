import type { CommandContext, EvidenceRecord, EvidenceRepository } from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { asc, eq, inArray } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { blobs, workspaces } from "./schema/core.js";
import { evidence, evidenceBlobs } from "./schema/gates.js";
import { businessAuditEvents } from "./schema/operations.js";
import { runConfigSnapshots, runs } from "./schema/runs.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

export class SqliteEvidenceRepository implements EvidenceRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async getRunContext(runId: Parameters<EvidenceRepository["getRunContext"]>[0]) {
    try {
      const row = this.database.orm.select({
        runId: runs.id, missionId: runs.missionId, attempt: runs.userAttempt,
        workspaceId: runConfigSnapshots.workspaceId, snapshotCwd: runConfigSnapshots.cwd,
        workspaceRoot: workspaces.path
      }).from(runs).innerJoin(runConfigSnapshots, eq(runConfigSnapshots.runId, runs.id))
        .innerJoin(workspaces, eq(workspaces.id, runConfigSnapshots.workspaceId)).where(eq(runs.id, runId)).get();
      if (!row || !row.missionId || !row.workspaceId) throw new DomainError("Run evidence context was not found", "RUN_NOT_FOUND");
      return { ...row, workspaceRoot: row.snapshotCwd, runId: toId(row.runId), missionId: toId(row.missionId), workspaceId: toId(row.workspaceId) };
    } catch (error) { throw translateSqliteError(error); }
  }

  async save(record: EvidenceRecord, context: CommandContext): Promise<void> {
    try {
      this.database.orm.transaction((transaction) => {
        if (transaction.select({ id: evidence.id }).from(evidence).where(eq(evidence.id, record.id)).get()) {
          throw new DomainError("Evidence identifiers are immutable", "EVIDENCE_ID_CONFLICT");
        }
        if (transaction.select({ id: businessAuditEvents.id }).from(businessAuditEvents).where(eq(businessAuditEvents.commandId, context.commandId)).get()) {
          throw new DomainError("Command was already processed", "COMMAND_ID_CONFLICT");
        }
        for (const linked of record.blobs) {
          const existing = transaction.select().from(blobs).where(eq(blobs.sha256, linked.blob.sha256)).get();
          if (existing && (existing.byteSize !== linked.blob.byteSize || existing.relativePath !== linked.blob.relativePath || existing.mimeType !== linked.blob.mimeType)) {
            throw new DomainError("Blob metadata does not match digest", "BLOB_DIGEST_MISMATCH");
          }
          transaction.insert(blobs).values(linked.blob).onConflictDoNothing({ target: blobs.sha256 }).run();
        }
        transaction.insert(evidence).values({
          id: record.id, runId: record.runId, kind: record.kind, subjectDigest: record.subjectDigest,
          collectorId: record.collectorId, collectorVersion: record.collectorVersion,
          payloadJson: JSON.stringify(record.payload), createdAt: record.createdAt
        }).run();
        for (const linked of record.blobs) transaction.insert(evidenceBlobs).values({ evidenceId: record.id, blobId: linked.blob.id, role: linked.role }).run();
        transaction.insert(businessAuditEvents).values({
          id: `audit/${context.commandId}`, aggregateKind: "run", aggregateId: record.runId,
          commandId: context.commandId, eventType: "EVIDENCE_RECORDED", actor: context.actor,
          payloadJson: JSON.stringify({ schemaVersion: 1, evidenceId: record.id, kind: record.kind, collectorId: record.collectorId, collectorVersion: record.collectorVersion }),
          occurredAt: context.occurredAt
        }).run();
      });
    } catch (error) { throw translateSqliteError(error); }
  }

  async list(runId: Parameters<EvidenceRepository["list"]>[0]) {
    try {
      const rows = this.database.orm.select().from(evidence).where(eq(evidence.runId, runId)).orderBy(asc(evidence.createdAt)).all();
      return this.hydrate(rows);
    } catch (error) { throw translateSqliteError(error); }
  }

  async show(evidenceId: Parameters<EvidenceRepository["show"]>[0]) {
    try {
      const row = this.database.orm.select().from(evidence).where(eq(evidence.id, evidenceId)).get();
      if (!row) throw new DomainError("Evidence was not found", "EVIDENCE_NOT_FOUND");
      return (await this.hydrate([row]))[0]!;
    } catch (error) { throw translateSqliteError(error); }
  }

  private async hydrate(rows: Array<typeof evidence.$inferSelect>): Promise<EvidenceRecord[]> {
    if (rows.length === 0) return [];
    const links = this.database.orm.select({ link: evidenceBlobs, blob: blobs }).from(evidenceBlobs)
      .innerJoin(blobs, eq(blobs.id, evidenceBlobs.blobId)).where(inArray(evidenceBlobs.evidenceId, rows.map((row) => row.id))).all();
    return rows.map((row) => ({
      id: toId(row.id), runId: toId(row.runId), kind: row.kind, subjectDigest: row.subjectDigest,
      collectorId: row.collectorId, collectorVersion: row.collectorVersion,
      payload: JSON.parse(row.payloadJson) as Record<string, unknown>, createdAt: row.createdAt,
      blobs: links.filter(({ link }) => link.evidenceId === row.id).map(({ link, blob }) => ({ role: link.role, blob: { ...blob, id: toId(blob.id), mimeType: blob.mimeType ?? "application/octet-stream" } }))
    }));
  }
}
