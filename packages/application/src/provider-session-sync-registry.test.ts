import { describe, expect, it } from "vitest";
import type { ProviderSessionSyncPort } from "./provider-session-sync-port.js";
import { ProviderSessionSyncRegistry } from "./provider-session-sync-registry.js";

const provider = (providerId: string): ProviderSessionSyncPort => ({
  providerId,
  capabilities: async () => { throw new Error("not used"); },
  listSessions: async () => { throw new Error("not used"); },
  readSession: async () => { throw new Error("not used"); },
  readHistory: async () => { throw new Error("not used"); },
  subscribe: () => { throw new Error("not used"); }
});

describe("ProviderSessionSyncRegistry", () => {
  it("resolves the session synchronization provider by its exact identifier", () => {
    const codex = provider("codex");
    const opencode = provider("opencode");

    const registry = new ProviderSessionSyncRegistry([codex, opencode]);

    expect(registry.resolve("codex")).toBe(codex);
    expect(registry.resolve("opencode")).toBe(opencode);
  });

  it("rejects duplicate provider identifiers with a stable code", () => {
    expect(() => new ProviderSessionSyncRegistry([provider("codex"), provider("codex")]))
      .toThrow(expect.objectContaining({ code: "PROVIDER_SESSION_SYNC_REGISTRATION_CONFLICT" }));
  });

  it("rejects an absent provider with a stable code", () => {
    const registry = new ProviderSessionSyncRegistry([]);

    expect(() => registry.resolve("missing"))
      .toThrow(expect.objectContaining({ code: "PROVIDER_SESSION_SYNC_PROVIDER_NOT_FOUND" }));
  });
});
