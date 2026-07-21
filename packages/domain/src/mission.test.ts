import { describe, expect, it } from "vitest";
import { asId, Mission } from "./index.js";

describe("Mission", () => {
  it("creates a draft and applies an explicit ready transition", () => {
    const mission = Mission.create({
      id: asId("mission-1"),
      title: "  Establish the local baseline  ",
      executionKind: "human",
      now: "2026-07-21T10:00:00.000Z"
    });

    mission.markReady("2026-07-21T10:01:00.000Z");

    expect(mission.snapshot()).toMatchObject({
      title: "Establish the local baseline",
      state: "READY",
      version: 1
    });
  });
});
