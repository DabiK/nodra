import { DomainError, type Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type {
  BlobStorePort,
  CommandObservationPort,
  EvidenceRecord,
  EvidenceRepository,
  GitObservationPort
} from "./evidence-model.js";

export class CollectEvidence {
  constructor(
    private readonly repository: EvidenceRepository,
    private readonly blobs: BlobStorePort,
    private readonly commands: CommandObservationPort,
    private readonly git: GitObservationPort
  ) {}

  async command(input: {
    evidenceId: Id;
    runId: Id;
    argv: readonly string[];
    cwd: string;
    timeoutMs: number;
    maxOutputBytes: number;
    context: CommandContext;
  }): Promise<EvidenceRecord> {
    if (input.argv.length === 0 || input.argv.some((part) => part.length === 0)) {
      throw new DomainError("argv must be a non-empty list of non-empty strings", "REQUEST_INVALID");
    }
    if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 300_000) {
      throw new DomainError("timeoutMs must be between 1 and 300000", "REQUEST_INVALID");
    }
    if (!Number.isInteger(input.maxOutputBytes) || input.maxOutputBytes < 1 || input.maxOutputBytes > 10_000_000) {
      throw new DomainError("maxOutputBytes must be between 1 and 10000000", "REQUEST_INVALID");
    }
    const run = await this.repository.getRunContext(input.runId);
    const observation = await this.commands.collect({
      argv: input.argv,
      cwd: input.cwd,
      workspaceRoot: run.workspaceRoot,
      timeoutMs: input.timeoutMs,
      maxOutputBytes: input.maxOutputBytes
    });
    const stdout = await this.blobs.put(observation.stdout, "text/plain; charset=utf-8", observation.endedAt);
    const stderr = await this.blobs.put(observation.stderr, "text/plain; charset=utf-8", observation.endedAt);
    const subjectDigest = observation.gitAfter?.treeDigest ?? stdout.sha256;
    const payload = {
      ...observation,
      stdout: undefined,
      stderr: undefined,
      runId: run.runId,
      missionId: run.missionId,
      attempt: run.attempt,
      stdoutSha256: stdout.sha256,
      stderrSha256: stderr.sha256
    };
    const record: EvidenceRecord = {
      id: input.evidenceId,
      runId: run.runId,
      kind: "observation",
      subjectDigest,
      collectorId: observation.collectorId,
      collectorVersion: observation.collectorVersion,
      payload,
      createdAt: observation.endedAt,
      blobs: [{ role: "stdout", blob: stdout }, { role: "stderr", blob: stderr }]
    };
    await this.repository.save(record, input.context);
    return record;
  }

  async gitObservation(input: { evidenceId: Id; runId: Id; context: CommandContext }): Promise<EvidenceRecord> {
    const run = await this.repository.getRunContext(input.runId);
    const observation = await this.git.observe(run.snapshotCwd, run.workspaceRoot);
    const record: EvidenceRecord = {
      id: input.evidenceId,
      runId: run.runId,
      kind: "observation",
      subjectDigest: observation.treeDigest,
      collectorId: observation.collectorId,
      collectorVersion: observation.collectorVersion,
      payload: { ...observation, runId: run.runId, missionId: run.missionId, attempt: run.attempt },
      createdAt: observation.capturedAt,
      blobs: []
    };
    await this.repository.save(record, input.context);
    return record;
  }
}
