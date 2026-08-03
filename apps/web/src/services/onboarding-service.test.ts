// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissWelcomeBanner, loadWelcomeDismissed } from "./onboarding-service";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("onboarding-service", () => {
  it("montre la bannière de bienvenue au premier lancement", () => {
    expect(loadWelcomeDismissed()).toBe(false);
  });

  it("la masque définitivement une fois rejetée", () => {
    dismissWelcomeBanner();
    expect(loadWelcomeDismissed()).toBe(true);
  });

  it("reste visible quand le stockage échoue", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(loadWelcomeDismissed()).toBe(false);
  });
});
