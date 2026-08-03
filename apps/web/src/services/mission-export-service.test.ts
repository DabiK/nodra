import { describe, expect, it } from "vitest";
import type { AgentConfigView, MissionRunsView, MissionView } from "../types";
import type { EvidenceView } from "./evidence-service";
import type { MissionAuditView } from "./mission-audit-service";
import type { MissionResultView } from "./mission-result-service";
import {
  buildMissionMarkdown,
  describeAuditEvent,
  escapeCell,
  exportFileName,
  toBlockquote
} from "./mission-export-service";

const mission: MissionView = {
  id: "m1",
  projectId: null,
  title: "Refactor du module billing",
  executionKind: "agent",
  state: "VALIDATION",
  version: 4,
  createdAt: "2026-08-02T08:00:00Z",
  updatedAt: "2026-08-02T10:00:00Z",
  runState: "SUCCEEDED",
  runStartedAt: "2026-08-02T09:00:00Z",
  lastAssistantMessage: null, tagIds: []
};

const config: AgentConfigView = {
  missionId: "m1",
  version: 2,
  providerId: "opencode",
  modelId: "model-a",
  reasoningEffort: "high",
  providerOptions: { schemaVersion: 1, value: {} },
  missionPrompt: "Refactore le module billing.\nCouvre les cas limites.",
  permissionPreset: "workspace",
  workspaceId: "ws-1",
  autoCommitAuthorized: true,
  integrationTargetRef: "main",
  updatedAt: "2026-08-02T09:30:00Z"
};

const result: MissionResultView = {
  latestRunId: "run-1",
  latestRunState: "SUCCEEDED",
  delivery: {
    id: "delivery-1",
    runId: "run-1",
    agentDeclaration: "Le module billing est refactoré.",
    observationSummary: null,
    resultState: "delivered",
    acceptedAt: null,
    decisionComment: "OK, à revoir sur la tarification.",
    createdAt: "2026-08-02T09:45:00Z",
    updatedAt: "2026-08-02T09:45:00Z"
  },
  assistantMessage: "Le module billing est refactoré.",
  hasStructuredDelivery: true,
  failure: null
};

const runs: MissionRunsView = {
  totalCostMicros: 18_888,
  runs: [
    {
      id: "run-1",
      attempt: 1,
      state: "SUCCEEDED",
      providerId: "opencode",
      modelId: "model-a",
      startedAt: "2026-08-02T09:00:00Z",
      endedAt: "2026-08-02T09:30:00Z",
      durationMs: 1_800_000,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      costMicros: 12_345,
      usageKind: "reported"
    },
    {
      id: "run-2",
      attempt: 2,
      state: "FAILED",
      providerId: "opencode",
      modelId: "model-a",
      startedAt: "2026-08-02T10:00:00Z",
      endedAt: "2026-08-02T10:01:00Z",
      durationMs: 60_000,
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      costMicros: null,
      usageKind: null
    }
  ]
};

const audit: MissionAuditView[] = [
  {
    id: "audit/1",
    commandId: "cmd-1",
    eventType: "MISSION_PREPARED",
    actor: "user",
    payload: { schemaVersion: 1, fromState: "BACKLOG", toState: "READY" },
    occurredAt: "2026-08-02T08:30:00Z"
  },
  {
    id: "audit/2",
    commandId: "cmd-2",
    eventType: "MISSION_SUBMITTED_FOR_VALIDATION",
    actor: "user",
    payload: { schemaVersion: 1, fromState: "ACTIVE", toState: "VALIDATION", declaredResult: "Le module billing est refactoré." },
    occurredAt: "2026-08-02T09:50:00Z"
  }
];

const evidence: EvidenceView[] = [
  {
    id: "evidence-1",
    runId: "run-1",
    kind: "observation",
    subjectDigest: "abc",
    collectorId: "nodra.git",
    collectorVersion: "1",
    createdAt: "2026-08-02T09:40:00Z",
    blobs: [{ role: "report", blob: { id: "blob-1", sha256: "aa", relativePath: "report.md", mimeType: "text/markdown", byteSize: 10, createdAt: "2026-08-02T09:40:00Z" } }]
  }
];

describe("mission-export-service", () => {
  it("construit un Markdown complet : entête, config, prompt, résultat, preuves, notes, runs, audit", () => {
    const md = buildMissionMarkdown({ mission, config, result, runs, notes: "Penser à la tarification.", audit, evidence });

    expect(md).toContain("# Mission : Refactor du module billing");
    expect(md).toContain("| Statut | VALIDATION |");
    expect(md).toContain("| Créée le | 2026-08-02T08:00:00Z |");
    expect(md).toContain("## Configuration agent");
    expect(md).toContain("| Provider | opencode |");
    expect(md).toContain("| Modèle | model-a |");
    expect(md).toContain("## Prompt");
    expect(md).toContain("> Refactore le module billing.");
    expect(md).toContain("> Couvre les cas limites.");
    expect(md).toContain("## Résultat déclaré");
    expect(md).toContain("> Le module billing est refactoré.");
    expect(md).toContain("Commentaire de décision : OK, à revoir sur la tarification.");
    expect(md).toContain("## Preuves");
    expect(md).toContain("- observation — `evidence-1` (nodra.git v1) — report.md");
    expect(md).toContain("## Notes");
    expect(md).toContain("> Penser à la tarification.");
    expect(md).toContain("## Historique des runs");
    expect(md).toContain("| **Total** | | | | | **$0.0189** |");
    expect(md).toContain("| 1 | SUCCEEDED | model-a | 30 min 00 s | 1,5 k | $0.0123 |");
    expect(md).toContain("## Timeline d'audit");
    expect(md).toContain("| 2026-08-02T08:30:00Z | Mise en file (BACKLOG → READY) | user |");
    expect(md).toContain("Soumission en validation (ACTIVE → VALIDATION)");
  });

  it("gère une mission minimale : sans config, sans run, sans notes, sans preuve, sans audit", () => {
    const md = buildMissionMarkdown({
      mission: { ...mission, executionKind: "human" },
      config: null,
      result: null,
      runs: null,
      notes: "",
      audit: [],
      evidence: []
    });

    expect(md).toContain("_Non activée._");
    expect(md).toContain("_Aucun prompt configuré._");
    expect(md).toContain("_Aucun résultat déclaré._");
    expect(md).toContain("_Aucune preuve collectée._");
    expect(md).toContain("_Aucune note._");
    expect(md).toContain("_Aucun run à ce jour._");
    expect(md).toContain("_Aucun événement d'audit._");
  });

  it("échappe les barres verticales et retours à la ligne dans les cellules", () => {
    expect(escapeCell("a | b\nc")).toBe("a \\| b c");
    expect(escapeCell(null)).toBe("");
  });

  it("convertit un texte multi-lignes en blockquote GFM", () => {
    expect(toBlockquote("ligne 1\nligne 2")).toBe("> ligne 1\n> ligne 2");
    expect(toBlockquote(undefined)).toBe("");
  });

  it("décrit un événement d'audit : libellé connu + transition, sinon type brut", () => {
    expect(describeAuditEvent(audit[0])).toBe("Mise en file (BACKLOG → READY)");
    expect(describeAuditEvent({
      id: "x",
      commandId: "x",
      eventType: "EVENT_INCONNU",
      actor: "manager",
      payload: {},
      occurredAt: "2026-08-02T08:30:00Z"
    })).toBe("EVENT_INCONNU");
  });

  it("génère un nom de fichier d'export lisible", () => {
    expect(exportFileName(mission)).toBe("mission-refactor-du-module-billing-m1.md");
    expect(exportFileName({ ...mission, title: "!!" })).toBe("mission-export-m1.md");
  });
});
