import { DomainError, type Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type { BlobStorePort, EvidenceRepository, GitObservationPort } from "./evidence-model.js";
import type { GateDefinitionRecord, GateEvaluatorRegistryPort, GateRepository } from "./gate-model.js";

export class ManageGates {
  constructor(
    private readonly gates: GateRepository,
    private readonly evidence: EvidenceRepository,
    private readonly blobs: BlobStorePort,
    private readonly evaluators: GateEvaluatorRegistryPort,
    private readonly git: GitObservationPort
  ) {}

  async define(input: { definition: GateDefinitionRecord; missionBindingId: Id; missionId: Id; context: CommandContext }) {
    if (!input.definition.name.trim()) throw new DomainError("Gate name is required", "REQUEST_INVALID");
    const binding = { id: input.missionBindingId, gateId: input.definition.id, missionId: input.missionId };
    await this.gates.defineMissionGate(input.definition, binding, input.context);
    return { definition: input.definition, binding };
  }

  async evaluate(input: { evaluationId: Id; bindingId: Id; runId: Id; evidenceIds: readonly Id[]; context: CommandContext }) {
    const { definition } = await this.gates.getBinding(input.bindingId);
    const records = await Promise.all(input.evidenceIds.map((id) => this.evidence.show(id)));
    const run = await this.evidence.getRunContext(input.runId);
    let blobValid = true;
    for (const record of records) for (const linked of record.blobs) blobValid &&= await this.blobs.verify(linked.blob);
    const invalid = this.validateEvidence(records, run);
    const result = invalid
      ? { state: "failed" as const, rationale: invalid, gitDependent: false }
      : blobValid
      ? this.evaluators.evaluate(definition, records, input.runId)
      : { state: "failed" as const, rationale: "BLOB_MISSING_OR_CORRUPT", gitDependent: false };
    const evaluation = {
      id: input.evaluationId,
      gateBindingId: input.bindingId,
      runId: input.runId,
      evaluatorId: definition.evaluatorId,
      evaluatorVersion: definition.evaluatorVersion,
      state: result.state,
      evaluatedAt: input.context.occurredAt,
      staleAt: null,
      rationale: result.rationale,
      evidenceIds: input.evidenceIds
    } as const;
    await this.gates.saveEvaluation(evaluation, input.context);
    return evaluation;
  }

  list(gateId: Id) { return this.gates.listEvaluations(gateId); }

  async refreshStaleness(input: { runId: Id; context: CommandContext }) {
    const run = await this.evidence.getRunContext(input.runId);
    const current = await this.git.observe(run.snapshotCwd, run.workspaceRoot);
    const evaluations = await this.gates.listPassedGitEvaluations(input.runId);
    const stale: Id[] = [];
    for (const evaluation of evaluations) {
      const linked = await Promise.all(evaluation.evidenceIds.map((id) => this.evidence.show(id)));
      if (linked.some((item) => item.subjectDigest !== current.treeDigest)) {
        await this.gates.markStale(evaluation.id, input.context.occurredAt, input.context);
        stale.push(evaluation.id);
      }
    }
    return { runId: input.runId, treeDigest: current.treeDigest, stale };
  }

  override(input: { overrideId: Id; evaluationId: Id; approvalId: Id; decision: "accept"|"reject"|"waive"; comment: string; context: CommandContext }) {
    if (!input.comment.trim()) throw new DomainError("Override comment is required", "REQUEST_INVALID");
    return this.gates.override(input);
  }

  private validateEvidence(records: readonly Awaited<ReturnType<EvidenceRepository["show"]>>[], run: Awaited<ReturnType<EvidenceRepository["getRunContext"]>>): string | null {
    for (const record of records) {
      if (record.runId !== run.runId || record.payload.runId !== run.runId || record.payload.missionId !== run.missionId || record.payload.attempt !== run.attempt) return "EVIDENCE_IDENTITY_MISMATCH";
      if (record.kind === "observation" && record.collectorId === "nodra.command") {
        const started = Date.parse(String(record.payload.startedAt)); const ended = Date.parse(String(record.payload.endedAt)); const created = Date.parse(record.createdAt);
        if (!Number.isFinite(started) || !Number.isFinite(ended) || started > ended || ended > created) return "EVIDENCE_TIMESTAMPS_INVALID";
        if (typeof record.payload.cwd !== "string" || typeof record.payload.workspaceRoot !== "string" || !(record.payload.cwd === record.payload.workspaceRoot || record.payload.cwd.startsWith(`${record.payload.workspaceRoot}/`) || record.payload.cwd.startsWith(`${record.payload.workspaceRoot}\\`))) return "EVIDENCE_WORKSPACE_MISMATCH";
        const stdout = record.blobs.find((item) => item.role === "stdout")?.blob; const stderr = record.blobs.find((item) => item.role === "stderr")?.blob;
        if (!stdout || !stderr || stdout.sha256 !== record.payload.stdoutSha256 || stderr.sha256 !== record.payload.stderrSha256) return "EVIDENCE_DIGEST_MISMATCH";
        const gitAfter = record.payload.gitAfter as Record<string, unknown> | null;
        if (gitAfter && gitAfter.treeDigest !== record.subjectDigest) return "EVIDENCE_SUBJECT_MISMATCH";
      }
    }
    return null;
  }
}
