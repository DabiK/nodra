// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, initTheme, loadTheme, saveTheme, systemTheme } from "./theme-service";

afterEach(() => localStorage.clear());

describe("theme-service", () => {
  it("has no explicit preference by default", () => {
    expect(loadTheme()).toBeNull();
  });

  it("persists the chosen theme across reloads", () => {
    saveTheme("dark");
    expect(loadTheme()).toBe("dark");
    saveTheme("light");
    expect(loadTheme()).toBe("light");
  });

  it("ignores malformed persisted values", () => {
    localStorage.setItem("nodra.theme", "sepia");
    expect(loadTheme()).toBeNull();
  });

  it("applies the theme on the document root", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("resolves the system preference without consulting localStorage", () => {
    // jsdom does not implement matchMedia by default; stub it to a dark preference.
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = (query: string) => ({ matches: query === "(prefers-color-scheme: dark)" }) as MediaQueryList;
    try {
      expect(systemTheme()).toBe("dark");
    } finally {
      window.matchMedia = originalMatchMedia;
    }
    expect(systemTheme()).toBe("light");
  });

  it("init prefers the persisted choice over the system preference", () => {
    saveTheme("dark");
    expect(initTheme()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("init falls back to the system preference when nothing is stored", () => {
    expect(initTheme()).toBe(systemTheme());
    expect(document.documentElement.dataset.theme).toBe(systemTheme());
  });
});
