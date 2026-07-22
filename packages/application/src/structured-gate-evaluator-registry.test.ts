import { asId } from "@nodra/domain";
import { describe, expect, it } from "vitest";
import type { EvidenceRecord, GateDefinitionRecord } from "./index.js";
import { StructuredGateEvaluatorRegistry } from "./structured-gate-evaluator-registry.js";

const definition: GateDefinitionRecord = {
  id: asId("gate"), name: "tests", evaluatorId: "command-exit", evaluatorVersion: "1", criteriaSchemaVersion: 1,
  criteria: { schemaVersion: 1, expectedExitCode: 0, requiresGit: true },
  expectedEvidence: { schemaVersion: 1, kind: "observation", collectorId: "nodra.command", collectorVersion: "1", requiredBlobRoles: ["stdout", "stderr"], subject: { type: "git-tree" } },
  createdAt: "2026-07-22T10:00:00.000Z"
};
const blob = (role: "stdout" | "stderr") => ({ role, blob: { id: asId(`blob-${role}`), sha256: role === "stdout" ? "b".repeat(64) : "c".repeat(64), relativePath: `artifacts/${role}`, mimeType: "text/plain", byteSize: 1, createdAt: "2026-07-22T10:00:01.000Z" } });
const evidence = (overrides: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  id: asId("evidence"), runId: asId("run"), kind: "observation", subjectDigest: "a".repeat(64), collectorId: "nodra.command", collectorVersion: "1",
  payload: { schemaVersion: 1, argv: ["node", "--version"], cwd: "/workspace", startedAt: "2026-07-22T10:00:00.000Z", endedAt: "2026-07-22T10:00:01.000Z", timedOut: false, exitCode: 0, stdoutSha256: "b".repeat(64), stderrSha256: "c".repeat(64), gitAfter: { treeDigest: "a".repeat(64) } },
  createdAt: "2026-07-22T10:00:01.000Z", blobs: [blob("stdout"), blob("stderr")], ...overrides
});

describe("StructuredGateEvaluatorRegistry", () => {
  const registry = new StructuredGateEvaluatorRegistry();

  it("validates the versioned expected-evidence schema", () => {
    expect(registry.validateDefinition(definition)).toBeNull();
    expect(registry.validateDefinition({ ...definition, expectedEvidence: { schemaVersion: 1 } })).toBe("EXPECTED_EVIDENCE_SCHEMA_UNSUPPORTED");
    expect(registry.validateDefinition({ ...definition, expectedEvidence: { ...definition.expectedEvidence, collectorVersion: "2" } })).toBe("EXPECTED_EVIDENCE_INVALID");
    expect(registry.validateDefinition({ ...definition, expectedEvidence: { ...definition.expectedEvidence, subject: { type: "content-digest" } } })).toBe("EXPECTED_EVIDENCE_SUBJECT_MISMATCH");
  });

  it("never treats declarations or wrong collector identities as expected evidence", () => {
    expect(registry.evaluate(definition, [evidence({ kind: "declaration" })], asId("run"))).toMatchObject({ state: "failed", rationale: "EXPECTED_EVIDENCE_MISSING" });
    expect(registry.evaluate(definition, [evidence({ collectorId: "other" })], asId("run"))).toMatchObject({ state: "failed", rationale: "EXPECTED_EVIDENCE_MISSING" });
    expect(registry.evaluate(definition, [evidence({ collectorVersion: "2" })], asId("run"))).toMatchObject({ state: "failed", rationale: "EXPECTED_EVIDENCE_MISSING" });
  });

  it("rejects missing roles, incomplete payload and ambiguous matching evidence", () => {
    expect(registry.evaluate(definition, [evidence({ blobs: [blob("stdout")] })], asId("run"))).toMatchObject({ state: "failed", rationale: "EXPECTED_BLOB_ROLES_MISMATCH" });
    expect(registry.evaluate(definition, [evidence({ payload: { schemaVersion: 1 } })], asId("run"))).toMatchObject({ state: "failed", rationale: "EVIDENCE_INCOMPLETE" });
    expect(registry.evaluate(definition, [evidence(), evidence({ id: asId("second") })], asId("run"))).toMatchObject({ state: "failed", rationale: "EXPECTED_EVIDENCE_AMBIGUOUS" });
  });

  it("selects exactly the expected structured observation and marks its Git subject", () => {
    expect(registry.evaluate(definition, [evidence()], asId("run"))).toEqual({ state: "passed", rationale: "STRUCTURED_CRITERIA_SATISFIED", selectedEvidenceIds: ["evidence"], gitEvidenceIds: ["evidence"] });
  });

  it("rejects forged, non-hexadecimal and mismatched Git subjects", () => {
    expect(registry.evaluate(definition, [evidence({ subjectDigest: "z".repeat(64), payload: { ...evidence().payload, gitAfter: { treeDigest: "z".repeat(64) } } })], asId("run"))).toMatchObject({ state: "failed", rationale: "GIT_SUBJECT_DIGEST_MISMATCH" });
    expect(registry.evaluate(definition, [evidence({ payload: { ...evidence().payload, gitAfter: { treeDigest: "d".repeat(64) } } })], asId("run"))).toMatchObject({ state: "failed", rationale: "GIT_SUBJECT_DIGEST_MISMATCH" });
  });

  it("binds content subjects to both the payload and the stdout blob", () => {
    const contentDefinition: GateDefinitionRecord = {
      ...definition,
      criteria: { ...definition.criteria, requiresGit: false },
      expectedEvidence: { ...definition.expectedEvidence, subject: { type: "content-digest" } }
    };
    const contentEvidence = evidence({ subjectDigest: "b".repeat(64), payload: { ...evidence().payload, gitAfter: null } });
    expect(registry.evaluate(contentDefinition, [contentEvidence], asId("run"))).toMatchObject({ state: "passed" });
    expect(registry.evaluate(contentDefinition, [{ ...contentEvidence, subjectDigest: "a".repeat(64) }], asId("run"))).toMatchObject({ state: "failed", rationale: "CONTENT_SUBJECT_DIGEST_MISMATCH" });
    expect(registry.evaluate(contentDefinition, [{ ...contentEvidence, payload: { ...contentEvidence.payload, stdoutSha256: "d".repeat(64) } }], asId("run"))).toMatchObject({ state: "failed", rationale: "CONTENT_SUBJECT_DIGEST_MISMATCH" });
  });
});
