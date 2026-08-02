// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadViewMode, saveViewMode } from "./view-mode-service";

afterEach(() => localStorage.clear());

describe("view-mode-service", () => {
  it("defaults to board", () => {
    expect(loadViewMode()).toBe("board");
  });

  it("persists board/list across reloads", () => {
    saveViewMode("list");
    expect(loadViewMode()).toBe("list");
    saveViewMode("board");
    expect(loadViewMode()).toBe("board");
  });
});
