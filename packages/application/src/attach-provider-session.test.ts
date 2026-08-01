import { asId, type Id } from "@nodra/domain";
import { describe, expect, it } from "vitest";
import { AttachProviderSession } from "./attach-provider-session.js";
import type { ProviderSessionRepository } from "./provider-session-repository.js";

const repository = (attachToMission: ProviderSessionRepository["attachToMission"]): ProviderSessionRepository => ({
  attachToMission,
  observe: async () => { throw new Error("not used"); },
  load: async () => { throw new Error("not used"); },
  loadActiveLink: async () => { throw new Error("not used"); },
  listActiveLinksForMission: async () => { throw new Error("not used"); },
  createReadyAgentMissionAndAttach: async () => { throw new Error("not used"); }
});

describe("AttachProviderSession", () => {
  it("forwards the complete idempotent command to the repository seam", async () => {
    const input = {
      providerSessionId: asId("session/1"),
      missionId: asId("mission/1"),
      commandId: asId("command/attach-1"),
      actor: "user" as const,
      occurredAt: "2026-08-01T15:00:00.000Z"
    };
    const expected = { session: {} as never, link: {} as never };
    let received: unknown;
    const useCase = new AttachProviderSession(repository(async (command) => {
      received = command;
      return expected;
    }));

    await expect(useCase.execute(input)).resolves.toBe(expected);
    expect(received).toBe(input);
  });

  it("rejects a missing command identifier before reaching the repository", async () => {
    let called = false;
    const useCase = new AttachProviderSession(repository(async () => {
      called = true;
      throw new Error("must not be called");
    }));

    await expect(useCase.execute({
      providerSessionId: asId("session/1"),
      missionId: asId("mission/1"),
      commandId: "  " as Id,
      actor: "manager",
      occurredAt: "2026-08-01T15:00:00.000Z"
    })).rejects.toMatchObject({ code: "COMMAND_ID_REQUIRED" });
    expect(called).toBe(false);
  });
});
