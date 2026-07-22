import type { ExpectedEvidenceV1, GateDefinitionRecord, GateEvaluatorRegistryPort, GateEvaluatorResult } from "./gate-model.js";
import type { EvidenceRecord } from "./evidence-model.js";
import type { Id } from "@nodra/domain";

export class StructuredGateEvaluatorRegistry implements GateEvaluatorRegistryPort {
  validateDefinition(definition: GateDefinitionRecord): string | null {
    if (definition.evaluatorId !== "command-exit" || definition.evaluatorVersion !== "1") return "EVALUATOR_UNKNOWN";
    if (definition.criteriaSchemaVersion !== 1 || definition.criteria.schemaVersion !== 1 || !Number.isInteger(definition.criteria.expectedExitCode) || typeof definition.criteria.requiresGit !== "boolean" || !this.exactKeys(definition.criteria, ["schemaVersion", "expectedExitCode", "requiresGit"])) return "CRITERIA_SCHEMA_UNSUPPORTED";
    const expected = this.expected(definition);
    if (!expected) return "EXPECTED_EVIDENCE_SCHEMA_UNSUPPORTED";
    if (expected.kind !== "observation" || expected.collectorId !== "nodra.command" || expected.collectorVersion !== "1" || !this.exactKeys(definition.expectedEvidence, ["schemaVersion", "kind", "collectorId", "collectorVersion", "requiredBlobRoles", "subject"]) || !this.exactKeys(expected.subject, ["type"])) return "EXPECTED_EVIDENCE_INVALID";
    if (expected.requiredBlobRoles.length !== 2 || !expected.requiredBlobRoles.includes("stdout") || !expected.requiredBlobRoles.includes("stderr")) return "EXPECTED_EVIDENCE_INVALID";
    if ((definition.criteria.requiresGit === true) !== (expected.subject.type === "git-tree")) return "EXPECTED_EVIDENCE_SUBJECT_MISMATCH";
    return null;
  }

  evaluate(definition: GateDefinitionRecord, evidence: readonly EvidenceRecord[], runId: Id): GateEvaluatorResult {
    const definitionError = this.validateDefinition(definition);
    if (definitionError) return this.failed(definitionError);
    const expected = this.expected(definition)!;
    const expectedExitCode = definition.criteria.expectedExitCode;
    const matches = evidence.filter((item) => item.kind === expected.kind && item.collectorId === expected.collectorId && item.collectorVersion === expected.collectorVersion);
    if (matches.length === 0) return this.failed("EXPECTED_EVIDENCE_MISSING");
    if (matches.length > 1) return this.failed("EXPECTED_EVIDENCE_AMBIGUOUS");
    if (evidence.length !== 1) return this.failed("UNEXPECTED_EVIDENCE_SUPPLIED");
    const observation = matches[0]!;
    if (observation.runId !== runId) return this.failed("EVIDENCE_RUN_MISMATCH");
    if (observation.payload.schemaVersion !== 1) return this.failed("COLLECTOR_SCHEMA_UNSUPPORTED");
    const roles = observation.blobs.map((item) => item.role).sort();
    const expectedRoles = [...expected.requiredBlobRoles].sort();
    if (roles.length !== expectedRoles.length || roles.some((role, index) => role !== expectedRoles[index])) return this.failed("EXPECTED_BLOB_ROLES_MISMATCH");
    const payload = observation.payload;
    if (!Array.isArray(payload.argv) || typeof payload.cwd !== "string" || typeof payload.startedAt !== "string" ||
        typeof payload.endedAt !== "string" || typeof payload.timedOut !== "boolean" ||
        typeof payload.stdoutSha256 !== "string" || typeof payload.stderrSha256 !== "string") {
      return this.failed("EVIDENCE_INCOMPLETE");
    }
    if (payload.timedOut === true) return this.failed("COMMAND_TIMED_OUT");
    if (payload.exitCode !== expectedExitCode) return this.failed("EXIT_CODE_MISMATCH");
    if (expected.subject.type === "git-tree" && (!payload.gitAfter || typeof payload.gitAfter !== "object" || observation.subjectDigest.length !== 64)) {
      return this.failed("GIT_OBSERVATION_REQUIRED");
    }
    if (expected.subject.type === "content-digest" && observation.blobs.find((item) => item.role === "stdout")?.blob.sha256 !== payload.stdoutSha256) return this.failed("CONTENT_SUBJECT_DIGEST_MISMATCH");
    return { state: "passed", rationale: "STRUCTURED_CRITERIA_SATISFIED", selectedEvidenceIds: [observation.id], gitEvidenceIds: expected.subject.type === "git-tree" ? [observation.id] : [] };
  }

  private expected(definition: GateDefinitionRecord): ExpectedEvidenceV1 | null {
    const value = definition.expectedEvidence;
    if (value.schemaVersion !== 1 || typeof value.collectorId !== "string" || typeof value.collectorVersion !== "string" || !Array.isArray(value.requiredBlobRoles) || !value.requiredBlobRoles.every((role) => typeof role === "string") || !value.subject || typeof value.subject !== "object" || !["git-tree", "content-digest"].includes(String((value.subject as Record<string, unknown>).type))) return null;
    return value as unknown as ExpectedEvidenceV1;
  }

  private failed(rationale: string): GateEvaluatorResult { return { state: "failed", rationale, selectedEvidenceIds: [], gitEvidenceIds: [] }; }
  private exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean { const keys = Object.keys(value).sort(); return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index]); }
}
