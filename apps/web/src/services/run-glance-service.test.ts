import { describe, expect, it } from "vitest";
import type { ManagerView, MissionView, PipelineListItem } from "../types";
import { buildRunGlance, formatGlanceElapsed } from "./run-glance-service";

function mission(overrides: Partial<MissionView> & Pick<MissionView, "id" | "title" | "executionKind" | "state">): MissionView {
  return {
    projectId: null,
    version: 2,
    createdAt: "2026-01-01T10:00:00Z",
    updatedAt: "2026-01-01T10:00:00Z",
    runState: null,
    runStartedAt: null,
    lastAssistantMessage: null,
    ...overrides
  };
}

function pipeline(overrides: Partial<PipelineListItem> & Pick<PipelineListItem, "id" | "name">): PipelineListItem {
  return {
    state: "active",
    createdAt: "2026-01-01T10:00:00Z",
    runId: null,
    runState: null,
    startedAt: null,
    endedAt: null,
    totalCostMicros: null,
    nodes: [],
    edges: [],
    ...overrides
  };
}

function node(overrides: Partial<PipelineListItem["nodes"][number]>): PipelineListItem["nodes"][number] {
  return {
    nodeKey: "a",
    missionId: "m-1",
    missionTitle: "Mission A",
    missionKind: "agent",
    missionState: "ACTIVE",
    nodeRunState: null,
    transitionMode: "auto",
    runStartedAt: null,
    runEndedAt: null,
    runAttempt: null,
    runCostMicros: null,
    ...overrides
  };
}

function manager(overrides: Partial<ManagerView> & Pick<ManagerView, "id" | "name">): ManagerView {
  return {
    projectId: null,
    instruction: "",
    state: "draft",
    providerId: null,
    modelId: null,
    reasoningEffort: null,
    permissionPreset: "workspace",
    workspaceId: null,
    workspacePath: null,
    createdAt: "2026-01-01T10:00:00Z",
    updatedAt: "2026-01-01T10:00:00Z",
    archivedAt: null,
    activeRunId: null,
    currentThreadId: null,
    lastMessage: null,
    conversationCount: 0,
    ...overrides
  };
}

describe("buildRunGlance", () => {
  it("liste les missions avec un run actif (RUNNING) avec dernier message et état", () => {
    const items = buildRunGlance({
      missions: [mission({ id: "m1", title: "Refonte", executionKind: "agent", state: "ACTIVE", runState: "RUNNING", runStartedAt: "2026-08-03T09:00:00Z", lastAssistantMessage: "J'analyse la base de code." })],
      pipelines: [],
      managers: []
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "mission",
      id: "m1",
      title: "Refonte",
      detail: "J'analyse la base de code.",
      startedAt: "2026-08-03T09:00:00Z",
      stateLabel: "réfléchit…",
      tone: "running"
    });
  });

  it("couvre tous les états de run actif (QUEUED, STARTING, RUNNING, WAITING_APPROVAL, CANCELLING)", () => {
    const missions = (["QUEUED", "STARTING", "RUNNING", "WAITING_APPROVAL", "CANCELLING"] as const).map((runState, index) =>
      mission({ id: `m-${runState}`, title: `T-${index}`, executionKind: "agent", state: "ACTIVE", runState, runStartedAt: "2026-08-03T09:00:00Z" })
    );
    expect(buildRunGlance({ missions, pipelines: [], managers: [] })).toHaveLength(5);
  });

  it("exclut les missions sans run actif (runState null, terminé, autre état)", () => {
    const missions = [
      mission({ id: "m-null", title: "Sans run", executionKind: "agent", state: "ACTIVE" }),
      mission({ id: "m-done", title: "Run fini", executionKind: "agent", state: "ACTIVE", runState: "DONE" }),
      mission({ id: "m-ready", title: "Prête", executionKind: "agent", state: "READY", runState: "RUNNING" }),
      mission({ id: "m-val", title: "En validation", executionKind: "agent", state: "VALIDATION", runState: "RUNNING" })
    ];
    expect(buildRunGlance({ missions, pipelines: [], managers: [] })).toHaveLength(0);
  });

  it("liste les pipelines en run actif (queued/active/blocked) avec le nœud actif en détail", () => {
    const items = buildRunGlance({
      missions: [],
      pipelines: [pipeline({ id: "p1", name: "Release", runState: "active", startedAt: "2026-08-03T08:30:00Z", nodes: [node({ nodeKey: "review", missionTitle: "Revue de code", nodeRunState: "active" }), node({ nodeKey: "ship", missionTitle: "Livraison", nodeRunState: "pending" })] })],
      managers: []
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "pipeline",
      id: "p1",
      title: "Release",
      detail: "review · Revue de code",
      startedAt: "2026-08-03T08:30:00Z",
      stateLabel: "en cours",
      tone: "running"
    });
  });

  it("exclut les pipelines sans run actif (completed, archived, runState null)", () => {
    const pipelines = [
      pipeline({ id: "p-done", name: "Fini", runState: "completed" }),
      pipeline({ id: "p-arch", name: "Archivé", runState: "archived", state: "archived" }),
      pipeline({ id: "p-none", name: "Sans run" })
    ];
    expect(buildRunGlance({ missions: [], pipelines, managers: [] })).toHaveLength(0);
  });

  it("liste les managers actifs avec leur dernier retour", () => {
    const items = buildRunGlance({
      missions: [],
      pipelines: [],
      managers: [manager({ id: "mg1", name: "Nova", state: "active", updatedAt: "2026-08-03T07:45:00Z", lastMessage: "Pipeline relancé après correction." })]
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "manager",
      id: "mg1",
      title: "Nova",
      detail: "Pipeline relancé après correction.",
      startedAt: "2026-08-03T07:45:00Z",
      stateLabel: "en orchestration",
      tone: "manager"
    });
  });

  it("exclut les managers non actifs (draft, ready, blocked, archived)", () => {
    const managers = (["draft", "ready", "blocked", "archived"] as const).map((state, index) =>
      manager({ id: `mg-${state}`, name: `M-${index}`, state })
    );
    expect(buildRunGlance({ missions: [], pipelines: [], managers })).toHaveLength(0);
  });

  it("retombe sur le libellé d'état quand la mission n'a pas de dernier message", () => {
    const items = buildRunGlance({
      missions: [mission({ id: "m1", title: "Silencieuse", executionKind: "agent", state: "ACTIVE", runState: "WAITING_APPROVAL" })],
      pipelines: [],
      managers: []
    });
    expect(items[0]?.detail).toBe("attend une approbation");
  });

  it("retombe sur un détail générique pour une pipeline sans nœud actif", () => {
    const items = buildRunGlance({
      missions: [],
      pipelines: [pipeline({ id: "p1", name: "Queue", runState: "queued", nodes: [node({ nodeRunState: "pending" })] })],
      managers: []
    });
    expect(items[0]?.detail).toBe("avancement du run…");
    expect(items[0]?.stateLabel).toBe("en file d'attente");
  });

  it("tri par ancienneté de début (le plus ancien d'abord), puis par titre", () => {
    const items = buildRunGlance({
      missions: [
        mission({ id: "m-late", title: "Tardive", executionKind: "agent", state: "ACTIVE", runState: "RUNNING", runStartedAt: "2026-08-03T10:00:00Z" }),
        mission({ id: "m-early", title: "Ancienne", executionKind: "agent", state: "ACTIVE", runState: "RUNNING", runStartedAt: "2026-08-03T08:00:00Z" })
      ],
      pipelines: [pipeline({ id: "p1", name: "Milieu", runState: "active", startedAt: "2026-08-03T09:00:00Z" })],
      managers: []
    });
    expect(items.map((item) => item.id)).toEqual(["m-early", "p1", "m-late"]);
  });

  it("place les items sans date de début en fin de liste", () => {
    const items = buildRunGlance({
      missions: [mission({ id: "m-no-date", title: "Sans date", executionKind: "agent", state: "ACTIVE", runState: "RUNNING" })],
      pipelines: [pipeline({ id: "p1", name: "Daté", runState: "active", startedAt: "2026-08-03T09:00:00Z" })],
      managers: [manager({ id: "mg1", name: "Nova", state: "active", updatedAt: "2026-08-03T09:30:00Z" })]
    });
    expect(items.map((item) => item.id)).toEqual(["p1", "mg1", "m-no-date"]);
  });

  it("retourne une liste vide quand rien n'est actif", () => {
    expect(buildRunGlance({ missions: [], pipelines: [], managers: [] })).toEqual([]);
  });
});

describe("formatGlanceElapsed", () => {
  const now = Date.parse("2026-08-03T12:00:00Z");

  it("renvoie « à l'instant » sous la minute", () => {
    expect(formatGlanceElapsed("2026-08-03T11:59:30Z", now)).toBe("à l'instant");
  });

  it("formate les minutes, heures et jours", () => {
    expect(formatGlanceElapsed("2026-08-03T11:15:00Z", now)).toBe("il y a 45 min");
    expect(formatGlanceElapsed("2026-08-03T11:00:00Z", now)).toBe("il y a 1 h");
    expect(formatGlanceElapsed("2026-08-01T12:00:00Z", now)).toBe("il y a 2 j");
  });

  it("renvoie une chaîne vide sans date ou avec une date invalide", () => {
    expect(formatGlanceElapsed(null, now)).toBe("");
    expect(formatGlanceElapsed("pas-une-date", now)).toBe("");
  });

  it("ignore les dates futures (diff négative)", () => {
    expect(formatGlanceElapsed("2026-08-03T13:00:00Z", now)).toBe("");
  });
});
