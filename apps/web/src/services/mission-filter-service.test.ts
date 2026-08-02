// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadSavedMissionFilters, saveMissionFilters } from "./mission-filter-service";

afterEach(() => localStorage.clear());

describe("mission-filter-service", () => {
  it("defaults to empty filters", () => {
    expect(loadSavedMissionFilters()).toEqual({ query: "", state: "all", kind: "all", sort: "recent" });
  });

  it("persists filters across reloads", () => {
    saveMissionFilters({ query: "stripe", state: "ACTIVE", kind: "agent", sort: "title" });
    expect(loadSavedMissionFilters()).toEqual({ query: "stripe", state: "ACTIVE", kind: "agent", sort: "title" });
  });

  it("falls back to defaults when the stored payload is malformed", () => {
    localStorage.setItem("nodra.tasks.filters", "{not json");
    expect(loadSavedMissionFilters()).toEqual({ query: "", state: "all", kind: "all", sort: "recent" });
  });

  it("coerces unexpected stored shapes to safe defaults", () => {
    localStorage.setItem("nodra.tasks.filters", JSON.stringify({ query: 42, sort: true }));
    expect(loadSavedMissionFilters()).toEqual({ query: "", state: "all", kind: "all", sort: "recent" });
  });
});
