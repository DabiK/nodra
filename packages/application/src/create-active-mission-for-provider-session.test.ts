import { asId, type Id } from "@nodra/domain";
import { describe, expect, it } from "vitest";
import { CreateActiveMissionForProviderSession } from "./create-active-mission-for-provider-session.js";
import type { ProviderSessionRepository } from "./provider-session-repository.js";

const repository = (
  create: ProviderSessionRepository["createReadyAgentMissionAndAttach"]
): ProviderSessionRepository => ({
  createReadyAgentMissionAndAttach: create,
  observe: async () => { throw new Error("not used"); },
  load: async (id) => ({
    id, providerId: "codex", externalSessionRef: "thread/1", ownership: "external_observed",
    firstObservedAt: "2026-08-01T15:00:00.000Z", lastObservedAt: "2026-08-01T15:00:00.000Z"
  }),
  loadActiveLink: async () => { throw new Error("not used"); },
  listActiveLinksForMission: async () => { throw new Error("not used"); },
  latestSessionRefForMission: async () => null,
  attachToMission: async () => { throw new Error("not used"); }
});

const providers = {
  resolve: () => ({
    providerId: "codex",
    readSession: async () => ({
      session: {
        ref: { providerId: "codex", externalSessionId: "thread/1" }, title: "Session title", cwd: process.cwd(), state: "idle",
        sourceCreatedAt: null, sourceUpdatedAt: null, receivedAt: "2026-08-01T15:00:00.000Z"
      },
      turns: [], items: [], cursor: null
    })
  })
} as never;

describe("CreateActiveMissionForProviderSession", () => {
  it("delegates the atomic mission creation and attachment to the repository seam", async () => {
    const input = {
      providerSessionId: asId("session/1"),
      commandId: asId("command/create-1"),
      actor: "user" as const,
      occurredAt: "2026-08-01T15:00:00.000Z",
      title: "Investigate provider session",
      projectId: asId("project/1")
    };
    const expected = { session: {} as never, link: {} as never, mission: {} as never, config: {} as never, workspace: {} as never };
    const received: unknown[] = [];
    const useCase = new CreateActiveMissionForProviderSession(providers, repository(async (command) => {
      received.push(command);
      return expected;
    }));

    await expect(useCase.execute(input)).resolves.toBe(expected);
    await expect(useCase.execute(input)).resolves.toBe(expected);
    expect(received).toEqual([
      { ...input, title: "Investigate provider session", requestedTitle: "Investigate provider session", cwd: process.cwd(), missionPrompt: "Investigate provider session", missionId: asId("mission/provider-session/command/create-1") },
      { ...input, title: "Investigate provider session", requestedTitle: "Investigate provider session", cwd: process.cwd(), missionPrompt: "Investigate provider session", missionId: asId("mission/provider-session/command/create-1") }
    ]);
  });

  it("requires a stable command identifier before invoking the transaction seam", async () => {
    let called = false;
    const useCase = new CreateActiveMissionForProviderSession(providers, repository(async () => {
      called = true;
      throw new Error("must not be called");
    }));

    await expect(useCase.execute({
      providerSessionId: asId("session/1"),
      commandId: "" as Id,
      actor: "user",
      occurredAt: "2026-08-01T15:00:00.000Z",
      title: "Mission"
    })).rejects.toMatchObject({ code: "COMMAND_ID_REQUIRED" });
    expect(called).toBe(false);
  });
});
