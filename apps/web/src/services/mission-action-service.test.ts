// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MissionView } from "../types";
import { performMissionAction } from "./mission-action-service";

vi.mock("../api", () => ({ api: vi.fn() }));
import { api } from "../api";

const assign = vi.fn();

function mission(overrides: Partial<MissionView>): MissionView {
  return {
    id: "mission-1",
    projectId: null,
    title: "Pipeline step",
    executionKind: "agent",
    state: "ACTIVE",
    version: 2,
    createdAt: "2026-01-01T10:00:00Z",
    updatedAt: "2026-01-01T10:00:00Z",
    runState: null,
    runStartedAt: null,
    lastAssistantMessage: null,
    ...overrides
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("performMissionAction open-provider-session", () => {
  it("navigates to the conversation even when activation fails (mission without provider session)", async () => {
    vi.stubGlobal("location", { assign });
    vi.mocked(api).mockRejectedValueOnce(new Error("Mission mission-1 has no active provider session"));

    await performMissionAction({
      actionId: "open-provider-session",
      mission: mission({ state: "READY", version: 1 }),
      latestRunId: null
    });

    expect(api).toHaveBeenCalledWith(expect.stringContaining("/activate"), expect.objectContaining({ method: "POST" }));
    expect(assign).toHaveBeenCalledWith("/agent.html?missionId=mission-1");
  });

  it("navigates to the conversation without attempting activation for a non-READY mission", async () => {
    vi.stubGlobal("location", { assign });

    await performMissionAction({
      actionId: "open-provider-session",
      mission: mission({ state: "ACTIVE" }),
      latestRunId: "run-1"
    });

    expect(api).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("/agent.html?missionId=mission-1");
  });
});
