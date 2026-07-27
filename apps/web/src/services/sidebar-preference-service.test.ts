// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { appShellClassName, loadSidebarCollapsed, saveSidebarCollapsed } from "./sidebar-preference-service";

afterEach(() => localStorage.clear());

describe("sidebar-preference-service", () => {
  it("defaults to expanded", () => {
    expect(loadSidebarCollapsed()).toBe(false);
  });

  it("persists open/close across reloads", () => {
    saveSidebarCollapsed(true);
    expect(loadSidebarCollapsed()).toBe(true);
    saveSidebarCollapsed(false);
    expect(loadSidebarCollapsed()).toBe(false);
  });

  it("drives the main area via the app-shell class", () => {
    expect(appShellClassName(false)).toBe("app-shell");
    expect(appShellClassName(true)).toBe("app-shell sidebar-collapsed");
  });
});
