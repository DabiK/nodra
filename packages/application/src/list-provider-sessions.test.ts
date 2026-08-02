import { asId } from "@nodra/domain";
import { describe, expect, it } from "vitest";
import { ListProviderSessions } from "./list-provider-sessions.js";
import type { ProviderSessionRepository } from "./provider-session-repository.js";
import { ProviderSessionSyncError } from "./provider-session-sync-error.js";
import type { ProviderSessionSyncPort } from "./provider-session-sync-port.js";
import { ProviderSessionSyncRegistry } from "./provider-session-sync-registry.js";

const receivedAt = "2026-08-01T15:00:00.000Z";

describe("ListProviderSessions", () => {
  it("observes every live provider summary and preserves provider order and duplicates", async () => {
    const calls: string[] = [];
    const summary = {
      ref: { providerId: "codex", externalSessionId: "external/opaque" },
      title: "Live title",
      cwd: "/workspace",
      state: "idle" as const,
      sourceCreatedAt: null,
      sourceUpdatedAt: null,
      receivedAt
    };
    const sync: ProviderSessionSyncPort = {
      providerId: "codex",
      capabilities: async () => { throw new Error("not used"); },
      listSessions: async (query) => {
        calls.push(`list:${query.cursor}:${query.limit}`);
        return { sessions: [summary, summary], nextCursor: "next/opaque" };
      },
      readSession: async () => { throw new Error("not used"); },
      readHistory: async () => { throw new Error("not used"); },
      subscribe: () => { throw new Error("not used"); }
    };
    let generated = 0;
    const repository: ProviderSessionRepository = {
      observe: async (input) => {
        calls.push(`observe:${input.id}:${input.externalSessionRef}:${input.observedAt}`);
        return {
          id: input.id,
          providerId: input.providerId,
          externalSessionRef: input.externalSessionRef,
          ownership: "external_observed",
          firstObservedAt: input.observedAt,
          lastObservedAt: input.observedAt
        };
      },
      loadActiveLink: async (id) => {
        calls.push(`link:${id}`);
        return id === asId("local/1") ? {
          id: asId("link/1"),
          providerSessionId: id,
          missionId: asId("mission/1"),
          mode: "read_only",
          attachedAt: receivedAt,
          detachedAt: null
        } : null;
      },
      load: async () => { throw new Error("not used"); },
      listActiveLinksForMission: async () => { throw new Error("not used"); },
  latestSessionRefForMission: async () => null,
      attachToMission: async () => { throw new Error("not used"); },
      createReadyAgentMissionAndAttach: async () => { throw new Error("not used"); }
    };
    const useCase = new ListProviderSessions(
      new ProviderSessionSyncRegistry([sync]),
      repository,
      { next: () => asId(`local/${++generated}`) }
    );

    const result = await useCase.execute({ providerId: "codex", cursor: "cursor/opaque", limit: 2 });

    expect(result).toEqual({
      sessions: [
        {
          id: asId("local/1"),
          summary,
          link: {
            id: asId("link/1"),
            providerSessionId: asId("local/1"),
            missionId: asId("mission/1"),
            mode: "read_only",
            attachedAt: receivedAt,
            detachedAt: null
          }
        },
        { id: asId("local/2"), summary, link: null }
      ],
      nextCursor: "next/opaque"
    });
    expect(calls).toEqual([
      "list:cursor/opaque:2",
      `observe:local/1:external/opaque:${receivedAt}`,
      "link:local/1",
      `observe:local/2:external/opaque:${receivedAt}`,
      "link:local/2"
    ]);
  });

  it("rejects a summary attributed to another provider before observing it", async () => {
    let observed = false;
    const sync: ProviderSessionSyncPort = {
      providerId: "codex",
      capabilities: async () => { throw new Error("not used"); },
      listSessions: async () => ({
        sessions: [{
          ref: { providerId: "opencode", externalSessionId: "opaque" },
          title: null,
          cwd: null,
          state: "unknown",
          sourceCreatedAt: null,
          sourceUpdatedAt: null,
          receivedAt
        }],
        nextCursor: null
      }),
      readSession: async () => { throw new Error("not used"); },
      readHistory: async () => { throw new Error("not used"); },
      subscribe: () => { throw new Error("not used"); }
    };
    const sessions = {
      observe: async () => { observed = true; throw new Error("must not observe"); },
      load: async () => null,
      loadActiveLink: async () => null,
      listActiveLinksForMission: async () => [],
      latestSessionRefForMission: async () => null,
      attachToMission: async () => { throw new Error("not used"); },
      createReadyAgentMissionAndAttach: async () => { throw new Error("not used"); }
    } satisfies ProviderSessionRepository;
    const useCase = new ListProviderSessions(
      new ProviderSessionSyncRegistry([sync]),
      sessions,
      { next: () => asId("must-not-generate") }
    );

    await expect(useCase.execute({ providerId: "codex" })).rejects.toMatchObject({
      code: "PROVIDER_SESSION_PROTOCOL_INCOMPATIBLE"
    });
    expect(observed).toBe(false);
  });

  it("maps provider-neutral list failures to a stable domain error", async () => {
    const sync: ProviderSessionSyncPort = {
      providerId: "codex",
      capabilities: async () => { throw new Error("not used"); },
      listSessions: async () => {
        throw new ProviderSessionSyncError({
          code: "TRANSIENT_FAILURE",
          providerId: "codex",
          externalSessionId: null,
          retryable: true,
          message: "temporary provider failure"
        });
      },
      readSession: async () => { throw new Error("not used"); },
      readHistory: async () => { throw new Error("not used"); },
      subscribe: () => { throw new Error("not used"); }
    };
    const useCase = new ListProviderSessions(
      new ProviderSessionSyncRegistry([sync]),
      {} as ProviderSessionRepository,
      { next: () => asId("unused") }
    );

    await expect(useCase.execute({ providerId: "codex" })).rejects.toMatchObject({
      code: "PROVIDER_SESSION_SYNC_TRANSIENT"
    });
  });
});
