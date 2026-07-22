import type { Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type { EvidenceRecord, GitObservationPort } from "./evidence-model.js";

export interface GateDefinitionRecord {
  id: Id;
  name: string;
  evaluatorId: string;
  evaluatorVersion: string;
  criteriaSchemaVersion: number;
  criteria: Record<string, unknown>;
  expectedEvidence: Record<string, unknown>;
  createdAt: string;
}

export interface GateBindingRecord { id: Id; gateId: Id; missionId: Id; }
export type GateEvaluationState = "pending" | "passed" | "failed" | "stale" | "overridden";
export interface GateEvaluationRecord {
  id: Id;
  gateBindingId: Id;
  runId: Id;
  evaluatorId: string;
  evaluatorVersion: string;
  state: GateEvaluationState;
  evaluatedAt: string;
  staleAt: string | null;
  rationale: string;
  evidenceIds: readonly Id[];
  gitEvidenceIds: readonly Id[];
}

export interface ExpectedEvidenceV1 {
  schemaVersion: 1;
  kind: "observation";
  collectorId: string;
  collectorVersion: string;
  requiredBlobRoles: readonly string[];
  subject: { type: "git-tree" | "content-digest" };
}

export interface GateEvaluatorResult {
  state: "passed" | "failed";
  rationale: string;
  selectedEvidenceIds: readonly Id[];
  gitEvidenceIds: readonly Id[];
}
export interface GateEvaluatorRegistryPort {
  validateDefinition(definition: GateDefinitionRecord): string | null;
  evaluate(definition: GateDefinitionRecord, evidence: readonly EvidenceRecord[], runId: Id): GateEvaluatorResult;
}

export interface GateRepository {
  defineMissionGate(definition: GateDefinitionRecord, binding: GateBindingRecord, context: CommandContext): Promise<void>;
  getBinding(bindingId: Id): Promise<{ binding: GateBindingRecord; definition: GateDefinitionRecord }>;
  saveEvaluation(evaluation: GateEvaluationRecord, context: CommandContext): Promise<void>;
  listEvaluations(gateId: Id): Promise<readonly GateEvaluationRecord[]>;
  listPassedGitEvaluations(runId: Id): Promise<readonly GateEvaluationRecord[]>;
  markStale(evaluationId: Id, staleAt: string, context: CommandContext): Promise<void>;
  override(input: { overrideId: Id; evaluationId: Id; approvalId: Id; decision: "accept"|"reject"|"waive"; comment: string; context: CommandContext }): Promise<GateEvaluationRecord>;
}

export interface StalenessDependencies {
  gates: GateRepository;
  git: GitObservationPort;
}

export interface GateFreshnessPort {
  refreshStaleness(input: { runId: Id; context: CommandContext }): Promise<{ runId: Id; treeDigest: string; stale: readonly Id[] }>;
}
