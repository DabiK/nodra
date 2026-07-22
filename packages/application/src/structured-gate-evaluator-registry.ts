import type { GateDefinitionRecord, GateEvaluatorRegistryPort, GateEvaluatorResult } from "./gate-model.js";
import type { EvidenceRecord } from "./evidence-model.js";
import type { Id } from "@nodra/domain";

export class StructuredGateEvaluatorRegistry implements GateEvaluatorRegistryPort {
  evaluate(definition: GateDefinitionRecord, evidence: readonly EvidenceRecord[], runId: Id): GateEvaluatorResult {
    if (definition.evaluatorId !== "command-exit" || definition.evaluatorVersion !== "1") {
      return { state: "failed", rationale: "EVALUATOR_UNKNOWN", gitDependent: false };
    }
    if (definition.criteriaSchemaVersion !== 1 || definition.criteria.schemaVersion !== 1) {
      return { state: "failed", rationale: "CRITERIA_SCHEMA_UNSUPPORTED", gitDependent: false };
    }
    const expectedExitCode = definition.criteria.expectedExitCode;
    const requiresGit = definition.criteria.requiresGit === true;
    if (!Number.isInteger(expectedExitCode)) {
      return { state: "failed", rationale: "CRITERIA_INVALID", gitDependent: requiresGit };
    }
    const observation = evidence.find((item) => item.kind === "observation" && item.collectorId === "nodra.command");
    if (!observation) return { state: "failed", rationale: "EXPECTED_OBSERVATION_MISSING", gitDependent: requiresGit };
    if (observation.runId !== runId) return { state: "failed", rationale: "EVIDENCE_RUN_MISMATCH", gitDependent: requiresGit };
    if (observation.collectorVersion !== "1" || observation.payload.schemaVersion !== 1) {
      return { state: "failed", rationale: "COLLECTOR_SCHEMA_UNSUPPORTED", gitDependent: requiresGit };
    }
    const payload = observation.payload;
    if (!Array.isArray(payload.argv) || typeof payload.cwd !== "string" || typeof payload.startedAt !== "string" ||
        typeof payload.endedAt !== "string" || typeof payload.timedOut !== "boolean" ||
        typeof payload.stdoutSha256 !== "string" || typeof payload.stderrSha256 !== "string") {
      return { state: "failed", rationale: "EVIDENCE_INCOMPLETE", gitDependent: requiresGit };
    }
    if (payload.timedOut === true) return { state: "failed", rationale: "COMMAND_TIMED_OUT", gitDependent: requiresGit };
    if (payload.exitCode !== expectedExitCode) return { state: "failed", rationale: "EXIT_CODE_MISMATCH", gitDependent: requiresGit };
    if (requiresGit && (!payload.gitAfter || typeof payload.gitAfter !== "object" || observation.subjectDigest.length !== 64)) {
      return { state: "failed", rationale: "GIT_OBSERVATION_REQUIRED", gitDependent: true };
    }
    return { state: "passed", rationale: "STRUCTURED_CRITERIA_SATISFIED", gitDependent: requiresGit };
  }
}
