import { describe, expect, it } from "vitest";
import { asId, Mission, type MissionState } from "./index.js";

const now = "2026-07-22T10:00:00.000Z";
const states: readonly MissionState[] = ["DRAFT", "READY", "ACTIVE", "BLOCKED", "VALIDATION", "DONE", "ABANDONED"];

const humanIn = (state: MissionState): Mission =>
  Mission.rehydrate({
    id: asId(`human-${state}`),
    projectId: null,
    title: "Human mission",
    executionKind: "human",
    state,
    version: 4,
    createdAt: now,
    updatedAt: now
  });

const agentIn = (state: MissionState): Mission =>
  Mission.rehydrate({ ...humanIn(state).snapshot(), id: asId(`agent-${state}`), executionKind: "agent" });

const expectTransition = (mission: Mission, action: () => void, target: MissionState) => {
  action();
  expect(mission.snapshot()).toMatchObject({ state: target, version: 5, updatedAt: now });
};

const expectForbiddenEverywhereExcept = (
  allowed: readonly MissionState[],
  factory: (state: MissionState) => Mission,
  action: (mission: Mission) => void
) => {
  for (const state of states.filter((candidate) => !allowed.includes(candidate))) {
    expect(() => action(factory(state)), state).toThrowError(expect.objectContaining({ code: "TRANSITION_FORBIDDEN" }));
  }
};

describe("Mission human lifecycle", () => {
  it("creates a trimmed human draft without project or agent state", () => {
    const mission = Mission.createHuman({ id: asId("mission-1"), title: "  Establish baseline  ", now });
    expect(mission.snapshot()).toEqual({
      id: "mission-1",
      projectId: null,
      title: "Establish baseline",
      executionKind: "human",
      state: "DRAFT",
      version: 0,
      createdAt: now,
      updatedAt: now
    });
  });

  it("requires a title", () => {
    expect(() => Mission.createHuman({ id: asId("mission-1"), title: "   ", now })).toThrowError(
      expect.objectContaining({ code: "MISSION_TITLE_REQUIRED" })
    );
  });

  it("allows every normative human transition", () => {
    const draft = humanIn("DRAFT");
    expectTransition(draft, () => draft.prepare(now), "READY");
    const ready = humanIn("READY");
    expectTransition(ready, () => ready.pickup(now), "ACTIVE");
    const active = humanIn("ACTIVE");
    expectTransition(active, () => active.block(now, "Waiting for a decision"), "BLOCKED");
    const blocked = humanIn("BLOCKED");
    expectTransition(blocked, () => blocked.resume(now), "READY");
    for (const state of ["DRAFT", "READY", "ACTIVE"] as const) {
      const mission = humanIn(state);
      expectTransition(mission, () => mission.close(now), "DONE");
    }
    for (const state of ["DRAFT", "READY", "BLOCKED", "VALIDATION"] as const) {
      const mission = humanIn(state);
      expectTransition(mission, () => mission.abandon(now), "ABANDONED");
    }
    for (const state of ["DONE", "ABANDONED"] as const) {
      const ready = humanIn(state);
      expectTransition(ready, () => ready.reopenReady(now), "READY");
      const active = humanIn(state);
      expectTransition(active, () => active.reopenActive(now), "ACTIVE");
    }
  });

  it("rejects every forbidden source state for human commands", () => {
    expectForbiddenEverywhereExcept(["DRAFT"], humanIn, (mission) => mission.prepare(now));
    expectForbiddenEverywhereExcept(["READY"], humanIn, (mission) => mission.pickup(now));
    expectForbiddenEverywhereExcept(["ACTIVE"], humanIn, (mission) => mission.block(now, "blocked"));
    expectForbiddenEverywhereExcept(["BLOCKED"], humanIn, (mission) => mission.resume(now));
    expectForbiddenEverywhereExcept(["DRAFT", "READY", "ACTIVE"], humanIn, (mission) => mission.close(now));
    expectForbiddenEverywhereExcept(["DRAFT", "READY", "BLOCKED", "VALIDATION"], humanIn, (mission) => mission.abandon(now));
    expectForbiddenEverywhereExcept(["DONE", "ABANDONED"], humanIn, (mission) => mission.reopenReady(now));
    expectForbiddenEverywhereExcept(["DONE", "ABANDONED"], humanIn, (mission) => mission.reopenActive(now));
  });

  it("requires a structured blocking reason", () => {
    expect(() => humanIn("ACTIVE").block(now, "  ")).toThrowError(
      expect.objectContaining({ code: "BLOCK_REASON_REQUIRED" })
    );
  });
});

describe("Mission result, evidence and acceptance boundaries", () => {
  it("records a base agent success for human validation without requiring a gate", () => {
    const mission = agentIn("ACTIVE");
    mission.recordAgentSuccess(now, "Persisted provider result");
    expect(mission.snapshot().state).toBe("VALIDATION");
    expect(() => agentIn("ACTIVE").recordAgentSuccess(now, "  "))
      .toThrowError(expect.objectContaining({ code: "VALIDATION_RESULT_REQUIRED" }));
  });

  it("covers agent activation and blocking without exposing them as I2 human commands", () => {
    const ready = agentIn("READY");
    expectTransition(ready, () => ready.startAgent(now), "ACTIVE");
    const active = agentIn("ACTIVE");
    expectTransition(active, () => active.blockAgent(now, "provider"), "BLOCKED");
    expectForbiddenEverywhereExcept(["READY"], agentIn, (mission) => mission.startAgent(now));
    expectForbiddenEverywhereExcept(["ACTIVE"], agentIn, (mission) => mission.blockAgent(now, "budget"));
  });

  it("keeps agent declaration, observed evidence and human acceptance distinct", () => {
    const mission = agentIn("ACTIVE");
    mission.submitForValidation(now, {
      runSucceeded: true,
      declaredResult: "Implementation complete",
      gateEvidenceIds: [asId("evidence-1")]
    });
    expect(mission.snapshot().state).toBe("VALIDATION");
    mission.accept(now, { accepted: true, actor: "user" });
    expect(mission.snapshot().state).toBe("DONE");
  });

  it("implements the normative validation correction path", () => {
    const mission = agentIn("VALIDATION");
    expectTransition(mission, () => mission.requestCorrection(now), "READY");
  });

  it("rejects every forbidden source state for agent result and decision transitions", () => {
    expectForbiddenEverywhereExcept(["ACTIVE"], agentIn, (mission) =>
      mission.submitForValidation(now, {
        runSucceeded: true,
        declaredResult: "complete",
        gateEvidenceIds: [asId("evidence-1")]
      })
    );
    expectForbiddenEverywhereExcept(["VALIDATION"], agentIn, (mission) =>
      mission.accept(now, { accepted: true, actor: "user" })
    );
    expectForbiddenEverywhereExcept(["VALIDATION"], agentIn, (mission) => mission.requestCorrection(now));
  });

  it("does not let a human mission simulate agent delivery or acceptance", () => {
    expect(() =>
      humanIn("ACTIVE").submitForValidation(now, {
        runSucceeded: true,
        declaredResult: "fake",
        gateEvidenceIds: [asId("evidence-1")]
      })
    ).toThrowError(expect.objectContaining({ code: "TRANSITION_FORBIDDEN" }));
    expect(() => humanIn("VALIDATION").accept(now, { accepted: true, actor: "user" })).toThrowError(
      expect.objectContaining({ code: "TRANSITION_FORBIDDEN" })
    );
  });

  it("requires observed evidence before validation", () => {
    expect(() =>
      agentIn("ACTIVE").submitForValidation(now, {
        runSucceeded: true,
        declaredResult: "complete",
        gateEvidenceIds: []
      })
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_EVIDENCE_REQUIRED" }));
  });
});
