import { asId, DomainError, Mission, type Id, type MissionState } from "@nodra/domain";
import { describe, expect, it, vi } from "vitest";
import { AutoValidateMissionAfterTurn } from "./auto-validate-mission-after-turn.js";
import type { MissionRepository, SaveMissionInput } from "./mission-repository.js";
import type { ProviderSessionItem, ProviderSessionRef, ProviderSessionSnapshot } from "./provider-session-sync-model.js";
import type { ProviderSessionSyncPort } from "./provider-session-sync-port.js";
import { ProviderSessionSyncRegistry } from "./provider-session-sync-registry.js";

const missionId = asId("mission/provider-session/test-1");
const ref: ProviderSessionRef = { providerId: "codex", externalSessionId: "thread/1" };
const now = "2026-08-01T15:00:00.000Z";

const agentMissionIn = (state: MissionState, version = 2): Mission => Mission.rehydrate({
  id: missionId,
  projectId: null,
  title: "Test mission",
  executionKind: "agent",
  state,
  version,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z"
});

const humanMissionIn = (state: MissionState, version = 2): Mission => Mission.rehydrate({
  id: missionId,
  projectId: null,
  title: "Test mission",
  executionKind: "human",
  state,
  version,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z"
});

const snapshotWith = (items: readonly ProviderSessionItem[]): ProviderSessionSnapshot => ({
  session: { ref, title: null, cwd: null, state: "idle", sourceCreatedAt: null, sourceUpdatedAt: null, receivedAt: now },
  turns: [],
  items: [...items],
  cursor: null
});

const assistant = (partial: Partial<ProviderSessionItem>): ProviderSessionItem => ({
  externalItemId: `item/${partial.externalTurnId ?? "t"}-${partial.order ?? 0}`,
  externalTurnId: partial.externalTurnId ?? "turn-1",
  role: "assistant",
  kind: "message",
  order: partial.order ?? 1,
  text: partial.text ?? "Declared result",
  name: null,
  sourceAt: null,
  receivedAt: now
});

const syncPort = (readSession: ProviderSessionSyncPort["readSession"]): ProviderSessionSyncPort => ({
  providerId: "codex",
  capabilities: async () => { throw new Error("not used"); },
  readSession,
  listSessions: async () => { throw new Error("not used"); },
  readHistory: async () => { throw new Error("not used"); },
  subscribe: () => { throw new Error("not used"); }
});

const repository = (load: MissionRepository["load"], save: MissionRepository["save"]): MissionRepository => ({ load, save });

const useCase = (missions: MissionRepository, readSession: ProviderSessionSyncPort["readSession"]) =>
  new AutoValidateMissionAfterTurn(missions, new ProviderSessionSyncRegistry([syncPort(readSession)]));

const input = (overrides: Partial<{ externalTurnId: string | null; ref: ProviderSessionRef }> = {}) => ({
  missionId,
  ref: overrides.ref ?? ref,
  externalTurnId: "externalTurnId" in overrides ? overrides.externalTurnId : "turn-9",
  occurredAt: now
});

describe("AutoValidateMissionAfterTurn", () => {
  it("transitions an ACTIVE agent mission to VALIDATION with relay, audit, and outbox records", async () => {
    const load = vi.fn<MissionRepository["load"]>(async () => agentMissionIn("ACTIVE"));
    const save = vi.fn<MissionRepository["save"]>(async () => undefined);
    const use = useCase(repository(load, save), async () => snapshotWith([assistant({ text: "  Done!" })]));

    await use.execute(input());

    expect(save).toHaveBeenCalledTimes(1);
    const saved: SaveMissionInput = save.mock.calls[0]![0];
    expect(saved.expectedVersion).toBe(2);
    expect(saved.mission.snapshot()).toMatchObject({ state: "VALIDATION", version: 3 });
    expect(saved.relay).toEqual({
      id: `relay/mission/${missionId}`,
      queue: "decision_required",
      reasonCode: "agent_result_requires_validation",
      createdAt: now
    });
    expect(saved.audit).toMatchObject({
      commandId: `turn-turn-9/${missionId}/auto-validated`,
      eventType: "MISSION_SUBMITTED_FOR_VALIDATION",
      actor: "manager",
      payload: { action: "auto-validate", fromState: "ACTIVE", toState: "VALIDATION", missionVersion: 3, declaredResult: "Done!" },
      occurredAt: now
    });
    expect(saved.outbox).toMatchObject({
      kind: "mission.changed",
      dedupeKey: `mission/${missionId}/version/3/auto-validate`,
      payload: { missionId, declaredResult: "Done!" }
    });
  });

  it("prefers the assistant message of the just-completed turn over a later fallback", async () => {
    const save = vi.fn<MissionRepository["save"]>(async () => undefined);
    const use = useCase(
      repository(vi.fn<MissionRepository["load"]>(async () => agentMissionIn("ACTIVE")), save),
      async () => snapshotWith([
        assistant({ externalTurnId: "turn-1", order: 1, text: "Older result" }),
        assistant({ externalTurnId: "turn-9", order: 2, text: "Latest result" })
      ])
    );

    await use.execute(input({ externalTurnId: "turn-1" }));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].audit.payload.declaredResult).toBe("Older result");
  });

  it("skips a mission that is already VALIDATION", async () => {
    const save = vi.fn<MissionRepository["save"]>(async () => undefined);
    const use = useCase(
      repository(vi.fn<MissionRepository["load"]>(async () => agentMissionIn("VALIDATION")), save),
      async () => snapshotWith([assistant({})])
    );

    await expect(use.execute(input())).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  it("skips a human mission", async () => {
    const save = vi.fn<MissionRepository["save"]>(async () => undefined);
    const use = useCase(
      repository(vi.fn<MissionRepository["load"]>(async () => humanMissionIn("ACTIVE")), save),
      async () => snapshotWith([assistant({})])
    );

    await expect(use.execute(input())).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  it("skips a missing mission", async () => {
    const save = vi.fn<MissionRepository["save"]>(async () => undefined);
    const use = useCase(
      repository(vi.fn<MissionRepository["load"]>(async () => null), save),
      async () => snapshotWith([assistant({})])
    );

    await expect(use.execute(input())).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  it("skips when the provider session has no assistant message", async () => {
    const save = vi.fn<MissionRepository["save"]>(async () => undefined);
    const use = useCase(
      repository(vi.fn<MissionRepository["load"]>(async () => agentMissionIn("ACTIVE")), save),
      async () => snapshotWith([{
        externalItemId: "item/user-1",
        externalTurnId: "turn-9",
        role: "user",
        kind: "message",
        order: 1,
        text: "Please work",
        name: null,
        sourceAt: null,
        receivedAt: now
      }])
    );

    await expect(use.execute(input())).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  it("skips when the snapshot read fails after a completed turn", async () => {
    const save = vi.fn<MissionRepository["save"]>(async () => undefined);
    const use = useCase(
      repository(vi.fn<MissionRepository["load"]>(async () => agentMissionIn("ACTIVE")), save),
      async () => { throw new Error("provider session gone"); }
    );

    await expect(use.execute(input())).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    "COMMAND_ID_CONFLICT",
    "MISSION_VERSION_CONFLICT",
    "TRANSITION_FORBIDDEN",
    "VALIDATION_RESULT_REQUIRED"
  ])("swallows an expected %s error from the save", async (code) => {
    const save = vi.fn<MissionRepository["save"]>(async () => { throw new DomainError(`expected ${code}`, code); });
    const use = useCase(
      repository(vi.fn<MissionRepository["load"]>(async () => agentMissionIn("ACTIVE")), save),
      async () => snapshotWith([assistant({})])
    );

    await expect(use.execute(input())).resolves.toBeUndefined();
  });

  it("propagates unexpected errors from the save", async () => {
    const save = vi.fn<MissionRepository["save"]>(async () => { throw new Error("database is down"); });
    const use = useCase(
      repository(vi.fn<MissionRepository["load"]>(async () => agentMissionIn("ACTIVE")), save),
      async () => snapshotWith([assistant({})])
    );

    await expect(use.execute(input())).rejects.toThrow("database is down");
  });

  it("uses the completed-turn fallback command id when no external turn id is known", async () => {
    const save = vi.fn<MissionRepository["save"]>(async () => undefined);
    const use = useCase(
      repository(vi.fn<MissionRepository["load"]>(async () => agentMissionIn("ACTIVE")), save),
      async () => snapshotWith([assistant({ externalTurnId: null })])
    );

    await use.execute(input({ externalTurnId: null }));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].audit.commandId).toBe(`turn-completed/${missionId}/auto-validated`);
  });
});
