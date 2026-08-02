// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { MissionView } from "../types";
import { filterMissions, type MissionFilters } from "./mission-filters";
import { saveMissionNotes } from "./mission-notes-service";

function mission(overrides: Partial<MissionView>): MissionView {
  return {
    id: "mission-a",
    projectId: null,
    title: "Implanter le module de paiement",
    executionKind: "agent",
    state: "ACTIVE",
    version: 2,
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...overrides
  };
}

const baseFilters: MissionFilters = { query: "", state: "all", kind: "all", sort: "recent" };

afterEach(() => localStorage.clear());

describe("filterMissions full-text search", () => {
  it("matches the mission title", () => {
    const missions = [mission({ id: "a", title: "Refonte du dashboard" }), mission({ id: "b", title: "Bugfix SSH" })];
    const result = filterMissions(missions, { ...baseFilters, query: "refonte" });
    expect(result.map((item) => item.id)).toEqual(["a"]);
  });

  it("matches the mission id", () => {
    const missions = [mission({ id: "mission-xyz-42" })];
    const result = filterMissions(missions, { ...baseFilters, query: "xyz" });
    expect(result.map((item) => item.id)).toEqual(["mission-xyz-42"]);
  });

  it("matches the state via its French label", () => {
    const missions = [
      mission({ id: "active", state: "ACTIVE", title: "Alpha" }),
      mission({ id: "done", state: "DONE", title: "Bêta" })
    ];
    const result = filterMissions(missions, { ...baseFilters, query: "en cours" });
    expect(result.map((item) => item.id)).toEqual(["active"]);
  });

  it("matches the raw state name", () => {
    const missions = [mission({ id: "valid", state: "VALIDATION", title: "Alpha" })];
    const result = filterMissions(missions, { ...baseFilters, query: "validation" });
    expect(result.map((item) => item.id)).toEqual(["valid"]);
  });

  it("matches the execution kind", () => {
    const missions = [
      mission({ id: "agent", executionKind: "agent", title: "Alpha" }),
      mission({ id: "human", executionKind: "human", title: "Bêta" })
    ];
    expect(filterMissions(missions, { ...baseFilters, query: "agent" }).map((item) => item.id)).toEqual(["agent"]);
    expect(filterMissions(missions, { ...baseFilters, query: "humain" }).map((item) => item.id)).toEqual(["human"]);
  });

  it("matches missions whose notes contain the query", () => {
    saveMissionNotes("mission-a", "Penser à vérifier le déploiement de prod");
    const missions = [mission({ id: "mission-a", title: "Alpha" }), mission({ id: "mission-b", title: "Bêta" })];
    const result = filterMissions(missions, { ...baseFilters, query: "déploiement" });
    expect(result.map((item) => item.id)).toEqual(["mission-a"]);
  });

  it("is case-insensitive", () => {
    const missions = [mission({ id: "a", title: "Migration Postgres" })];
    const result = filterMissions(missions, { ...baseFilters, query: "POSTGRES" });
    expect(result.map((item) => item.id)).toEqual(["a"]);
  });

  it("returns everything when the query is empty", () => {
    const missions = [mission({ id: "a" }), mission({ id: "b" })];
    expect(filterMissions(missions, baseFilters)).toHaveLength(2);
  });
});

describe("filterMissions combinable filters", () => {
  const missions = [
    mission({ id: "agent-active", executionKind: "agent", state: "ACTIVE", title: "Paiement Stripe" }),
    mission({ id: "agent-done", executionKind: "agent", state: "DONE", title: "Auth JWT" }),
    mission({ id: "human-active", executionKind: "human", state: "ACTIVE", title: "Paiement manuel" })
  ];

  it("combines state + kind + query", () => {
    const result = filterMissions(missions, { ...baseFilters, state: "ACTIVE", kind: "agent", query: "paiement" });
    expect(result.map((item) => item.id)).toEqual(["agent-active"]);
  });

  it("combines state + kind without query", () => {
    const result = filterMissions(missions, { ...baseFilters, state: "ACTIVE", kind: "human" });
    expect(result.map((item) => item.id)).toEqual(["human-active"]);
  });
});
