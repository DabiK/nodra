// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

describe("api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parse la réponse JSON d'un 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: "1" }]), { status: 200 })));
    await expect(api("/api/x")).resolves.toEqual([{ id: "1" }]);
  });

  it("ne consomme pas le cache HTTP (no-store) — un 304 du cache casserait tous les rafraîchissements live", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]", { status: 200 })));
    await api("/api/x");
    expect(fetch).toHaveBeenCalledWith("/api/x", expect.objectContaining({ cache: "no-store" }));
  });

  it("préserve les options et headers du caller", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await api("/api/x", { method: "POST", body: "{}", headers: { "x-custom": "1" } });
    expect(fetch).toHaveBeenCalledWith(
      "/api/x",
      expect.objectContaining({ method: "POST", body: "{}", headers: { "content-type": "application/json", "x-custom": "1" } })
    );
  });

  it("jette avec le statut HTTP sur une réponse non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await expect(api("/api/x")).rejects.toThrow("HTTP 404");
  });

  it("jette avec le body de l'erreur serveur quand il est présent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "boom" }), { status: 500 })));
    await expect(api("/api/x")).rejects.toThrow("boom");
  });
});
