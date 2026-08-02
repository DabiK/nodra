import { describe, expect, it } from "vitest";
import type { MissionView, PipelineListItem } from "../types";
import { buildPaletteCommands, filterPaletteCommands, groupPaletteCommands } from "./palette-service";

function mission(overrides: Partial<MissionView>): MissionView {
  return {
    id: "m1",
    projectId: null,
    title: "Mission test",
    executionKind: "agent",
    state: "READY",
    version: 1,
    createdAt: "2026-08-02T08:00:00Z",
    updatedAt: "2026-08-02T09:00:00Z",
    ...overrides
  };
}

function pipeline(overrides: Partial<PipelineListItem>): PipelineListItem {
  return {
    id: "p1",
    name: "Release",
    state: "active",
    createdAt: "2026-08-01T08:00:00Z",
    runId: "r1",
    runState: "active",
    startedAt: "2026-08-02T08:00:00Z",
    endedAt: null,
    totalCostMicros: null,
    nodes: [],
    edges: [],
    ...overrides
  };
}

describe("buildPaletteCommands", () => {
  it("expose toujours la navigation vers les quatre pages", () => {
    const commands = buildPaletteCommands({ page: "tasks", missions: [], pipelines: [] });
    const navigation = commands.filter((command) => command.group === "Navigation");
    expect(navigation.map((command) => command.action)).toEqual([
      { kind: "navigate", page: "tasks" },
      { kind: "navigate", page: "pipelines" },
      { kind: "navigate", page: "managers" },
      { kind: "navigate", page: "provider-sessions" }
    ]);
  });

  it("expose toujours la commande de création de mission", () => {
    const commands = buildPaletteCommands({ page: "tasks", missions: [], pipelines: [] });
    expect(commands.some((command) => command.action.kind === "create-mission")).toBe(true);
  });

  it("propose de démarrer un pipeline jamais lancé", () => {
    const commands = buildPaletteCommands({ page: "tasks", missions: [], pipelines: [pipeline({ runId: null, runState: null })] });
    const start = commands.find((command) => command.action.kind === "start-pipeline");
    expect(start).toBeDefined();
    expect(start?.action).toEqual({ kind: "start-pipeline", pipelineId: "p1" });
    expect(commands.some((command) => command.action.kind === "advance-pipeline")).toBe(false);
  });

  it("propose de relancer un run terminé et d'avancer un run actif", () => {
    const done = pipeline({ runId: "r9", runState: "completed" });
    const active = pipeline({ id: "p2", name: "Relay", runId: "r2", runState: "blocked" });
    const commands = buildPaletteCommands({ page: "tasks", missions: [], pipelines: [done, active] });
    expect(commands.some((command) => command.action.kind === "start-pipeline" && command.action.pipelineId === "p1")).toBe(true);
    const advance = commands.find((command) => command.action.kind === "advance-pipeline");
    expect(advance?.action).toEqual({ kind: "advance-pipeline", pipelineId: "p2", runId: "r2" });
  });

  it("n'offre ni démarrage ni avance pour un run qui n'est ni startable ni avancable", () => {
    const queued = pipeline({ runId: "r3", runState: "queued" });
    const commands = buildPaletteCommands({ page: "tasks", missions: [], pipelines: [queued] });
    expect(commands.some((command) => command.action.kind === "start-pipeline" || command.action.kind === "advance-pipeline")).toBe(false);
  });

  it("propose d'accepter la delivery des missions agent en VALIDATION", () => {
    const missions = [
      mission({ id: "m1", state: "VALIDATION", title: "Refonte API" }),
      mission({ id: "m2", state: "VALIDATION", executionKind: "human", title: "Humaine" }),
      mission({ id: "m3", state: "READY", title: "Prête" })
    ];
    const commands = buildPaletteCommands({ page: "tasks", missions, pipelines: [] });
    const accept = commands.find((command) => command.action.kind === "accept-delivery");
    expect(accept?.action).toEqual({ kind: "accept-delivery", missionId: "m1" });
    expect(accept?.label).toContain("Refonte API");
    const acceptForHuman = commands.some((command) => command.action.kind === "accept-delivery" && command.action.missionId === "m2");
    expect(acceptForHuman).toBe(false);
  });

  it("propose d'ouvrir chaque mission avec son id en mot-clé", () => {
    const commands = buildPaletteCommands({ page: "tasks", missions: [mission({ id: "m42" })], pipelines: [] });
    const open = commands.find((command) => command.action.kind === "open-mission");
    expect(open?.action).toEqual({ kind: "open-mission", missionId: "m42" });
    expect(open?.keywords).toContain("m42");
  });
});

describe("filterPaletteCommands", () => {
  const commands = buildPaletteCommands({ page: "tasks", missions: [mission({ id: "m1", state: "VALIDATION", title: "Refonte API" })], pipelines: [pipeline({ runId: null })] });

  it("retourne tout quand la requête est vide", () => {
    expect(filterPaletteCommands(commands, "")).toHaveLength(commands.length);
    expect(filterPaletteCommands(commands, "   ")).toHaveLength(commands.length);
  });

  it("filtre sur le label, le hint et les mots-clés, insensible à la casse", () => {
    const byLabel = filterPaletteCommands(commands, "pipelines");
    expect(byLabel.some((command) => command.id === "nav-pipelines")).toBe(true);
    const byKeyword = filterPaletteCommands(commands, "delivery");
    expect(byKeyword.some((command) => command.action.kind === "accept-delivery")).toBe(true);
    const byId = filterPaletteCommands(commands, "M1");
    expect(byId.some((command) => command.action.kind === "accept-delivery")).toBe(true);
    const byHint = filterPaletteCommands(commands, "formulaire");
    expect(byHint.some((command) => command.action.kind === "create-mission")).toBe(true);
  });
});

describe("groupPaletteCommands", () => {
  it("regroupe les commandes filtrées dans l'ordre canonique des groupes", () => {
    const commands = buildPaletteCommands({ page: "tasks", missions: [mission({ id: "m1" })], pipelines: [pipeline({ runId: null })] });
    const groups = groupPaletteCommands(filterPaletteCommands(commands, ""));
    expect(groups.map((entry) => entry.group)).toEqual(["Navigation", "Création", "Runs de pipeline", "Missions"]);
    expect(groups.reduce((total, entry) => total + entry.commands.length, 0)).toBe(commands.length);
  });

  it("omet les groupes vides", () => {
    const groups = groupPaletteCommands([{ id: "x", label: "x", hint: "", group: "Missions", keywords: [], action: { kind: "create-mission" } }]);
    expect(groups.map((entry) => entry.group)).toEqual(["Missions"]);
  });
});
