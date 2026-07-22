import type { Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";

export type EvidenceKind = "declaration" | "observation" | "validation";
export type EvidenceBlobRole = "stdout" | "stderr" | "report" | "output" | "other";

export interface RunEvidenceContext {
  runId: Id;
  missionId: Id;
  attempt: number;
  workspaceId: Id;
  workspaceRoot: string;
  snapshotCwd: string;
}

export interface BlobRecord {
  id: Id;
  sha256: string;
  relativePath: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
}

export interface EvidenceRecord {
  id: Id;
  runId: Id;
  kind: EvidenceKind;
  subjectDigest: string;
  collectorId: string;
  collectorVersion: string;
  payload: Record<string, unknown>;
  createdAt: string;
  blobs: ReadonlyArray<{ role: EvidenceBlobRole; blob: BlobRecord }>;
}

export interface CommandObservation {
  schemaVersion: 1;
  collectorId: "nodra.command";
  collectorVersion: "1";
  argv: readonly string[];
  cwd: string;
  workspaceRoot: string;
  environment: Record<string, "[REDACTED]">;
  startedAt: string;
  endedAt: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  outputTruncated: boolean;
  gitBefore: GitObservation | null;
  gitAfter: GitObservation | null;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

export interface GitObservation {
  schemaVersion: 1;
  collectorId: "nodra.git";
  collectorVersion: "1";
  cwd: string;
  head: string;
  treeDigest: string;
  diffDigest: string;
  dirty: boolean;
  capturedAt: string;
}

export interface EvidenceRepository {
  getRunContext(runId: Id): Promise<RunEvidenceContext>;
  save(record: EvidenceRecord, context: CommandContext): Promise<void>;
  list(runId: Id): Promise<readonly EvidenceRecord[]>;
  show(evidenceId: Id): Promise<EvidenceRecord>;
}

export interface BlobStorePort {
  put(content: Uint8Array, mimeType: string, occurredAt: string): Promise<BlobRecord>;
  verify(blob: BlobRecord): Promise<boolean>;
}

export interface CommandObservationPort {
  collect(input: {
    argv: readonly string[];
    cwd: string;
    workspaceRoot: string;
    timeoutMs: number;
    maxOutputBytes: number;
  }): Promise<CommandObservation>;
}

export interface GitObservationPort {
  observe(cwd: string, workspaceRoot: string): Promise<GitObservation>;
}
