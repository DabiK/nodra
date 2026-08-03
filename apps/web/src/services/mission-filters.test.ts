// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { MissionView } from "../types";
import { filterMissions, type MissionFilters } from "./mission-filters";
import { saveMissionNotes } from "./mission-notes-service";
import { dayKey, todayKey, type MissionSchedule } from "./mission-schedule-service";

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
    runState: null,
    runStartedAt: null,
    lastAssistantMessage: null, tagIds: [],
    ...overrides
  };
}

const baseFilters: MissionFilters = { query: "", state: "all", kind: "all", sort: "recent", day: "all", tags: [] };

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

describe("filterMissions tag filter (issue #23)", () => {
  const missions = [
    mission({ id: "tagged-a", tagIds: ["tag-urgent", "tag-wip"], title: "A taguée" }),
    mission({ id: "tagged-b", tagIds: ["tag-urgent"], title: "B taguée" }),
    mission({ id: "plain", tagIds: [], title: "Sans tag" })
  ];

  it("keeps everything when no tag is selected", () => {
    expect(filterMissions(missions, baseFilters)).toHaveLength(3);
  });

  it("keeps missions carrying at least one selected tag", () => {
    const result = filterMissions(missions, { ...baseFilters, tags: ["tag-urgent"] });
    expect(result.map((item) => item.id)).toEqual(["tagged-a", "tagged-b"]);
  });

  it("keeps missions carrying any selected tag when several are chosen (OR)", () => {
    const result = filterMissions(missions, { ...baseFilters, tags: ["tag-urgent", "tag-wip"] });
    expect(result.map((item) => item.id)).toEqual(["tagged-a", "tagged-b"]);
  });

  it("returns nothing when the tag does not exist", () => {
    const result = filterMissions(missions, { ...baseFilters, tags: ["tag-ghost"] });
    expect(result).toEqual([]);
  });

  it("combines the tag filter with state and kind", () => {
    const mixed = [
      mission({ id: "agent-urgent", executionKind: "agent", state: "ACTIVE", tagIds: ["tag-urgent"], title: "A" }),
      mission({ id: "agent-plain", executionKind: "agent", state: "ACTIVE", tagIds: [], title: "B" }),
      mission({ id: "human-urgent", executionKind: "human", state: "ACTIVE", tagIds: ["tag-urgent"], title: "C" })
    ];
    const result = filterMissions(mixed, { ...baseFilters, tags: ["tag-urgent"], kind: "agent" });
    expect(result.map((item) => item.id)).toEqual(["agent-urgent"]);
  });

  it("tolerates missions without the tagIds field", () => {
    const legacy = [{ id: "legacy", title: "Ancienne" }] as unknown as MissionView[];
    expect(filterMissions(legacy, { ...baseFilters, tags: ["tag-urgent"] })).toEqual([]);
    expect(filterMissions(legacy, baseFilters)).toHaveLength(1);
  });
});

describe("filterMissions day filter (ma journée)", () => {
  const today = todayKey();
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const onDay = (day: string, time = "10:00:00") => `${day}T${time}`;

  it("keeps only the missions of the day and sorts by urgency when day is today", () => {
    const schedule: MissionSchedule = {
      "m-overdue": yesterday,
      "m-validation": today
    };
    const missions = [
      mission({ id: "m-overdue", title: "Retard", state: "ACTIVE", createdAt: onDay(yesterday), updatedAt: onDay(today, "08:00:00") }),
      mission({ id: "m-old", title: "Ancienne", state: "READY", createdAt: onDay(yesterday), updatedAt: onDay(yesterday, "11:00:00") }),
      mission({ id: "m-validation", title: "À valider", state: "VALIDATION", createdAt: onDay(yesterday), updatedAt: onDay(yesterday, "12:00:00") }),
      mission({ id: "m-new", title: "Nouvelle", state: "READY", createdAt: onDay(today), updatedAt: onDay(today) })
    ];
    const result = filterMissions(missions, { ...baseFilters, day: "today" }, schedule);
    expect(result.map((item) => item.id)).toEqual(["m-overdue", "m-validation", "m-new"]);
  });

  it("keeps every mission when day is all", () => {
    const missions = [
      mission({ id: "old", title: "Ancienne", createdAt: "2026-07-01T09:00:00", updatedAt: "2026-07-01T10:00:00" }),
      mission({ id: "today", title: "Aujourd'hui", createdAt: onDay(today), updatedAt: onDay(today) })
    ];
    expect(filterMissions(missions, baseFilters, {}).map((item) => item.id)).toEqual(["today", "old"]);
  });

  it("falls back to the regular sort when day is today without a schedule", () => {
    const missions = [
      mission({ id: "a", title: "A", state: "VALIDATION" }),
      mission({ id: "b", title: "B", state: "ACTIVE" })
    ];
    const result = filterMissions(missions, { ...baseFilters, day: "today" }, undefined);
    expect(result.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("combines the day filter with state and kind", () => {
    const schedule: MissionSchedule = {};
    const missions = [
      mission({ id: "agent-today", title: "Agent", executionKind: "agent", state: "READY", createdAt: onDay(today), updatedAt: onDay(today) }),
      mission({ id: "human-today", title: "Humain", executionKind: "human", state: "READY", createdAt: onDay(today), updatedAt: onDay(today) }),
      mission({ id: "agent-old", title: "Ancien", executionKind: "agent", state: "READY", createdAt: onDay(yesterday), updatedAt: onDay(yesterday) })
    ];
    const result = filterMissions(missions, { ...baseFilters, day: "today", kind: "agent" }, schedule);
    expect(result.map((item) => item.id)).toEqual(["agent-today"]);
  });
});
