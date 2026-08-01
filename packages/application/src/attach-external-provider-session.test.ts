import { asId } from "@nodra/domain";
import { describe, expect, it } from "vitest";
import { AttachExternalProviderSession } from "./attach-external-provider-session.js";
import type { ProviderSessionRepository } from "./provider-session-repository.js";

describe("AttachExternalProviderSession", () => {
  it("reads the provider external reference, observes its local identity, then atomically attaches it", async () => {
    const calls: string[] = [];
    const repository = {
      observe: async (input) => {
        calls.push(`observe:${input.id}:${input.providerId}:${input.externalSessionRef}`);
        return { id: input.id, providerId: input.providerId, externalSessionRef: input.externalSessionRef, ownership: "external_observed", firstObservedAt: input.observedAt, lastObservedAt: input.observedAt };
      },
      attachToMission: async (input) => {
        calls.push(`attach:${input.providerSessionId}:${input.missionId}:${input.commandId}`);
        return { session: {} as never, link: { providerSessionId: input.providerSessionId, missionId: input.missionId } as never };
      },
      load: async () => null,
      loadActiveLink: async () => null,
      listActiveLinksForMission: async () => [],
      createReadyAgentMissionAndAttach: async () => { throw new Error("not used"); }
    } satisfies ProviderSessionRepository;
    const providers = {
      resolve: (providerId: string) => ({
        providerId,
        readSession: async (ref: { providerId: string; externalSessionId: string }) => ({
          session: { ref, title: "Observed", cwd: null, state: "idle", sourceCreatedAt: null, sourceUpdatedAt: null, receivedAt: "2026-08-02T10:00:00.000Z" },
          turns: [], items: [], cursor: null
        })
      })
    } as never;
    const useCase = new AttachExternalProviderSession(providers, repository, { next: () => asId("provider-session/generated") });

    await expect(useCase.execute({
      providerId: "codex", externalSessionId: "thread/external-42", missionId: asId("mission/1"), commandId: asId("attach/stable"), actor: "user", occurredAt: "2026-08-02T10:01:00.000Z"
    })).resolves.toMatchObject({ link: { providerSessionId: "provider-session/generated", missionId: "mission/1" } });
    expect(calls).toEqual([
      "observe:provider-session/generated:codex:thread/external-42",
      "attach:provider-session/generated:mission/1:attach/stable"
    ]);
  });

  it("rejects a provider snapshot returned for a different external session before local writes", async () => {
    let observed = false;
    const repository = {
      observe: async () => { observed = true; throw new Error("not used"); },
      attachToMission: async () => { throw new Error("not used"); },
      load: async () => null, loadActiveLink: async () => null, listActiveLinksForMission: async () => [],
      createReadyAgentMissionAndAttach: async () => { throw new Error("not used"); }
    } satisfies ProviderSessionRepository;
    const providers = { resolve: () => ({ providerId: "codex", readSession: async () => ({
      session: { ref: { providerId: "codex", externalSessionId: "wrong" }, title: null, cwd: null, state: "idle", sourceCreatedAt: null, sourceUpdatedAt: null, receivedAt: "2026-08-02T10:00:00.000Z" }, turns: [], items: [], cursor: null
    }) }) } as never;

    await expect(new AttachExternalProviderSession(providers, repository, { next: () => asId("unused") }).execute({
      providerId: "codex", externalSessionId: "thread/expected", missionId: asId("mission/1"), commandId: asId("attach/stable"), actor: "user", occurredAt: "2026-08-02T10:01:00.000Z"
    })).rejects.toMatchObject({ code: "PROVIDER_SESSION_PROTOCOL_INCOMPATIBLE" });
    expect(observed).toBe(false);
  });
});
