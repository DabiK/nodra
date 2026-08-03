// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadSavedMissionFilters, saveMissionFilters } from "./mission-filter-service";

afterEach(() => localStorage.clear());

describe("mission-filter-service", () => {
  it("defaults to empty filters", () => {
    expect(loadSavedMissionFilters()).toEqual({ query: "", state: "all", kind: "all", sort: "recent", day: "all" });
  });

  it("persists filters across reloads", () => {
    saveMissionFilters({ query: "stripe", state: "ACTIVE", kind: "agent", sort: "title", day: "today" });
    expect(loadSavedMissionFilters()).toEqual({ query: "stripe", state: "ACTIVE", kind: "agent", sort: "title", day: "today" });
  });

  it("falls back to defaults when the stored payload is malformed", () => {
    localStorage.setItem("nodra.tasks.filters", "{not json");
    expect(loadSavedMissionFilters()).toEqual({ query: "", state: "all", kind: "all", sort: "recent", day: "all" });
  });

  it("coerces unexpected stored shapes to safe defaults", () => {
    localStorage.setItem("nodra.tasks.filters", JSON.stringify({ query: 42, sort: true, day: 7 }));
    expect(loadSavedMissionFilters()).toEqual({ query: "", state: "all", kind: "all", sort: "recent", day: "all" });
  });

  it("keeps the day filter as all when absent from the stored payload", () => {
    localStorage.setItem("nodra.tasks.filters", JSON.stringify({ query: "x", state: "READY", kind: "all", sort: "recent" }));
    expect(loadSavedMissionFilters().day).toBe("all");
  });
});
