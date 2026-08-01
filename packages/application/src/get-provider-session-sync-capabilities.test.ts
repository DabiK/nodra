import { describe, expect, it } from "vitest";
import { GetProviderSessionSyncCapabilities } from "./get-provider-session-sync-capabilities.js";
import { ProviderSessionSyncError } from "./provider-session-sync-error.js";
import type { ProviderSessionSyncPort } from "./provider-session-sync-port.js";
import { ProviderSessionSyncRegistry } from "./provider-session-sync-registry.js";

const provider = (
  capabilities: ProviderSessionSyncPort["capabilities"]
): ProviderSessionSyncPort => ({
  providerId: "codex",
  capabilities,
  listSessions: async () => { throw new Error("not used"); },
  readSession: async () => { throw new Error("not used"); },
  readHistory: async () => { throw new Error("not used"); },
  subscribe: () => { throw new Error("not used"); }
});

describe("GetProviderSessionSyncCapabilities", () => {
  it("returns the provider capability matrix intact", async () => {
    const matrix = {
      schemaVersion: 1 as const,
      providerId: "codex",
      listSessions: { state: "compatible_unverified" as const, reason: "poc", action: "run" },
      readSession: { state: "compatible_unverified" as const, reason: "poc", action: "run" },
      readHistory: { state: "unavailable" as const, reason: "none", action: null },
      subscribe: { state: "unavailable" as const, reason: "none", action: null },
      cursorResume: { state: "unavailable" as const, reason: "none", action: null },
      attachedControl: { state: "unavailable" as const, reason: "none", action: null }
    };
    const useCase = new GetProviderSessionSyncCapabilities(
      new ProviderSessionSyncRegistry([provider(async () => matrix)])
    );

    await expect(useCase.execute("codex")).resolves.toBe(matrix);
  });

  it("maps an unexpected provider failure without leaking it", async () => {
    const useCase = new GetProviderSessionSyncCapabilities(
      new ProviderSessionSyncRegistry([provider(async () => {
        throw new ProviderSessionSyncError({
          code: "ACCESS_DENIED",
          providerId: "codex",
          externalSessionId: null,
          retryable: false,
          message: "sensitive provider detail"
        });
      })])
    );

    await expect(useCase.execute("codex")).rejects.toMatchObject({
      code: "PROVIDER_SESSION_ACCESS_DENIED",
      message: "Access to the provider session was denied"
    });
  });
});
