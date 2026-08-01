import { asId } from "@nodra/domain";
import { describe, expect, it } from "vitest";
import type { ProviderSessionRepository } from "./provider-session-repository.js";
import { ProviderSessionSyncError } from "./provider-session-sync-error.js";
import { ProviderSessionSyncRegistry } from "./provider-session-sync-registry.js";
import type { ProviderSessionSyncPort } from "./provider-session-sync-port.js";
import { ShowProviderSession } from "./show-provider-session.js";

const localId = asId("provider-session/local-1");
const observedAt = "2026-08-01T15:00:00.000Z";
const identity = {
  id: localId,
  providerId: "codex",
  externalSessionRef: "opaque/external-ref",
  ownership: "external_observed" as const,
  firstObservedAt: observedAt,
  lastObservedAt: observedAt
};
const capabilities = {
  schemaVersion: 1 as const,
  providerId: "codex",
  listSessions: { state: "certified" as const, reason: null, action: null },
  readSession: { state: "compatible_unverified" as const, reason: "poc", action: "run" },
  readHistory: { state: "unavailable" as const, reason: "no", action: null },
  subscribe: { state: "unavailable" as const, reason: "no", action: null },
  cursorResume: { state: "unavailable" as const, reason: "no", action: null },
  attachedControl: { state: "unavailable" as const, reason: "no", action: null }
};

const repository = (load: ProviderSessionRepository["load"]): ProviderSessionRepository => ({
  load,
  loadActiveLink: async () => null,
  observe: async () => { throw new Error("not used"); },
  listActiveLinksForMission: async () => { throw new Error("not used"); },
  attachToMission: async () => { throw new Error("not used"); },
  createReadyAgentMissionAndAttach: async () => { throw new Error("not used"); }
});

describe("ShowProviderSession", () => {
  it("loads a local identity then rereads its exact opaque provider reference", async () => {
    const reads: unknown[] = [];
    const snapshot = {
      session: {
        ref: { providerId: "codex", externalSessionId: "opaque/external-ref" },
        title: "Provider live title",
        cwd: null,
        state: "active" as const,
        sourceCreatedAt: null,
        sourceUpdatedAt: null,
        receivedAt: observedAt
      },
      turns: [],
      items: [],
      cursor: null
    };
    const sync: ProviderSessionSyncPort = {
      providerId: "codex",
      capabilities: async () => capabilities,
      readSession: async (ref) => { reads.push(ref); return snapshot; },
      listSessions: async () => { throw new Error("not used"); },
      readHistory: async () => { throw new Error("not used"); },
      subscribe: () => { throw new Error("not used"); }
    };
    const useCase = new ShowProviderSession(
      new ProviderSessionSyncRegistry([sync]),
      repository(async () => identity)
    );

    const first = await useCase.execute(localId);
    const second = await useCase.execute(localId);

    expect(reads).toEqual([
      { providerId: "codex", externalSessionId: "opaque/external-ref" },
      { providerId: "codex", externalSessionId: "opaque/external-ref" }
    ]);
    expect(first).toEqual({ identity, snapshot, link: null, capabilities });
    expect(second.snapshot).toBe(snapshot);
  });

  it("reports a missing local identity with a stable code without calling a provider", async () => {
    const useCase = new ShowProviderSession(
      new ProviderSessionSyncRegistry([]),
      repository(async () => null)
    );

    await expect(useCase.execute(localId)).rejects.toMatchObject({
      code: "PROVIDER_SESSION_LOCAL_NOT_FOUND"
    });
  });

  it("rejects a provider snapshot for a different opaque session", async () => {
    const sync: ProviderSessionSyncPort = {
      providerId: "codex",
      capabilities: async () => capabilities,
      readSession: async () => ({
        session: {
          ref: { providerId: "codex", externalSessionId: "different/opaque-ref" },
          title: null,
          cwd: null,
          state: "unknown",
          sourceCreatedAt: null,
          sourceUpdatedAt: null,
          receivedAt: observedAt
        },
        turns: [],
        items: [],
        cursor: null
      }),
      listSessions: async () => { throw new Error("not used"); },
      readHistory: async () => { throw new Error("not used"); },
      subscribe: () => { throw new Error("not used"); }
    };
    const useCase = new ShowProviderSession(
      new ProviderSessionSyncRegistry([sync]),
      repository(async () => identity)
    );

    await expect(useCase.execute(localId)).rejects.toMatchObject({
      code: "PROVIDER_SESSION_PROTOCOL_INCOMPATIBLE"
    });
  });

  it.each([
    ["NOT_FOUND", false, "PROVIDER_SESSION_NOT_FOUND"],
    ["UNAVAILABLE", true, "PROVIDER_SESSION_SYNC_UNAVAILABLE"],
    ["INVALID_CURSOR", false, "PROVIDER_SESSION_PROTOCOL_INCOMPATIBLE"],
    ["PROTOCOL_INCOMPATIBLE", false, "PROVIDER_SESSION_PROTOCOL_INCOMPATIBLE"],
    ["TRANSIENT_FAILURE", true, "PROVIDER_SESSION_SYNC_TRANSIENT"],
    ["ACCESS_DENIED", false, "PROVIDER_SESSION_ACCESS_DENIED"],
    ["UNKNOWN", false, "PROVIDER_SESSION_SYNC_UNAVAILABLE"]
  ] as const)("maps provider-neutral %s failures to %s", async (failureCode, retryable, domainCode) => {
    const sync: ProviderSessionSyncPort = {
      providerId: "codex",
      capabilities: async () => capabilities,
      readSession: async () => {
        throw new ProviderSessionSyncError({
          code: failureCode,
          providerId: "codex",
          externalSessionId: "opaque/external-ref",
          retryable,
          message: "provider failure"
        });
      },
      listSessions: async () => { throw new Error("not used"); },
      readHistory: async () => { throw new Error("not used"); },
      subscribe: () => { throw new Error("not used"); }
    };
    const useCase = new ShowProviderSession(
      new ProviderSessionSyncRegistry([sync]),
      repository(async () => identity)
    );

    await expect(useCase.execute(localId)).rejects.toMatchObject({ code: domainCode });
  });
});
