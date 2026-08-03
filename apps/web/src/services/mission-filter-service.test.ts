// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadSavedMissionFilters, saveMissionFilters } from "./mission-filter-service";

afterEach(() => localStorage.clear());

describe("mission-filter-service", () => {
  it("defaults to empty filters", () => {
    expect(loadSavedMissionFilters()).toEqual({ query: "", state: "all", kind: "all", sort: "recent", day: "all", tags: [] });
  });

  it("persists filters across reloads", () => {
    saveMissionFilters({ query: "stripe", state: "ACTIVE", kind: "agent", sort: "title", day: "today", tags: ["tag-1"] });
    expect(loadSavedMissionFilters()).toEqual({ query: "stripe", state: "ACTIVE", kind: "agent", sort: "title", day: "today", tags: ["tag-1"] });
  });

  it("falls back to defaults when the stored payload is malformed", () => {
    localStorage.setItem("nodra.tasks.filters", "{not json");
    expect(loadSavedMissionFilters()).toEqual({ query: "", state: "all", kind: "all", sort: "recent", day: "all", tags: [] });
  });

  it("coerces unexpected stored shapes to safe defaults", () => {
    localStorage.setItem("nodra.tasks.filters", JSON.stringify({ query: 42, sort: true, day: 7, tags: "urgent" }));
    expect(loadSavedMissionFilters()).toEqual({ query: "", state: "all", kind: "all", sort: "recent", day: "all", tags: [] });
  });

  it("keeps the day filter as all when absent from the stored payload", () => {
    localStorage.setItem("nodra.tasks.filters", JSON.stringify({ query: "x", state: "READY", kind: "all", sort: "recent" }));
    expect(loadSavedMissionFilters().day).toBe("all");
  });

  it("keeps the tag filter as empty when absent from the stored payload", () => {
    localStorage.setItem("nodra.tasks.filters", JSON.stringify({ query: "x", state: "READY", kind: "all", sort: "recent", day: "all" }));
    expect(loadSavedMissionFilters().tags).toEqual([]);
  });

  it("filters out non-string tag ids from the stored payload", () => {
    localStorage.setItem("nodra.tasks.filters", JSON.stringify({ query: "", state: "all", kind: "all", sort: "recent", day: "all", tags: ["ok", 42, null] }));
    expect(loadSavedMissionFilters().tags).toEqual(["ok"]);
  });
});
