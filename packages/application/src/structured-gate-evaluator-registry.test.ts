import { asId } from "@nodra/domain";
import { describe, expect, it } from "vitest";
import type { EvidenceRecord, GateDefinitionRecord } from "./index.js";
import { StructuredGateEvaluatorRegistry } from "./structured-gate-evaluator-registry.js";

const definition: GateDefinitionRecord = { id: asId("gate"), name: "tests", evaluatorId: "command-exit", evaluatorVersion: "1", criteriaSchemaVersion: 1, criteria: { schemaVersion: 1, expectedExitCode: 0, requiresGit: true }, expectedEvidence: { schemaVersion: 1, collectorId: "nodra.command" }, createdAt: "2026-07-22T10:00:00.000Z" };
const evidence = (overrides: Partial<EvidenceRecord> = {}): EvidenceRecord => ({ id: asId("evidence"), runId: asId("run"), kind: "observation", subjectDigest: "a".repeat(64), collectorId: "nodra.command", collectorVersion: "1", payload: { schemaVersion: 1, argv: ["node", "--version"], cwd: "/workspace", startedAt: "2026-07-22T10:00:00.000Z", endedAt: "2026-07-22T10:00:01.000Z", timedOut: false, exitCode: 0, stdoutSha256: "b".repeat(64), stderrSha256: "c".repeat(64), gitAfter: { treeDigest: "a".repeat(64) } }, createdAt: "2026-07-22T10:00:01.000Z", blobs: [], ...overrides });

describe("StructuredGateEvaluatorRegistry", () => {
  it("never treats an agent declaration as a gate observation", () => { expect(new StructuredGateEvaluatorRegistry().evaluate(definition, [evidence({ kind: "declaration" })], asId("run"))).toMatchObject({ state: "failed", rationale: "EXPECTED_OBSERVATION_MISSING" }); });
  it("fails unknown collectors and incomplete evidence explicitly", () => {
    const registry = new StructuredGateEvaluatorRegistry();
    expect(registry.evaluate({ ...definition, evaluatorId: "unknown" }, [evidence()], asId("run"))).toMatchObject({ state: "failed", rationale: "EVALUATOR_UNKNOWN" });
    expect(registry.evaluate(definition, [evidence({ payload: { schemaVersion: 1 } })], asId("run"))).toMatchObject({ state: "failed", rationale: "EVIDENCE_INCOMPLETE" });
  });
  it("passes only the structured exit and Git criteria", () => { expect(new StructuredGateEvaluatorRegistry().evaluate(definition, [evidence()], asId("run"))).toMatchObject({ state: "passed" }); });
});
