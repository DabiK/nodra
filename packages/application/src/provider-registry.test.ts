import { describe, expect, it } from "vitest";
import type { ProviderPort } from "./provider-port.js";
import { ProviderRegistry } from "./provider-registry.js";

const provider = (providerId: string): ProviderPort => ({
  providerId,
  probe: async () => { throw new Error("not used"); },
  execute: async () => { throw new Error("not used"); },
  cancel: async () => undefined,
  steer: async () => undefined
});

describe("ProviderRegistry", () => {
  it("resolves the exact provider and never falls back", () => {
    const first = provider("first");
    const opencode = provider("opencode");
    const registry = new ProviderRegistry([first, opencode]);

    expect(registry.resolve("first")).toBe(first);
    expect(registry.resolve("opencode")).toBe(opencode);
    expect(() => registry.resolve("missing")).toThrow("Provider missing is unavailable");
  });

  it("rejects duplicate provider identifiers", () => {
    expect(() => new ProviderRegistry([provider("opencode"), provider("opencode")]))
      .toThrow("registered more than once");
  });
});
