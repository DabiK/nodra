import { describe, expect, it } from "vitest";
import { getMissionUiPolicy } from "./mission-ui-policy";

describe("mission UI policy for provider threads", () => {
  it("opens and activates an attached READY mission instead of launching a legacy run", () => {
    const policy = getMissionUiPolicy({
      mission: { id: "mission-1", projectId: null, title: "Attached", executionKind: "agent", state: "READY", version: 2, createdAt: "2026-01-01", updatedAt: "2026-01-01", runState: null, runStartedAt: null, lastAssistantMessage: null , tagIds: []},
      hasAgentConfig: true,
      latestRunId: "legacy-run",
      latestRunState: "SUCCEEDED",
      hasDelivery: false,
      hasResultText: false,
      hasProviderSession: true
    });

    expect(policy.primaryAction).toMatchObject({ id: "open-provider-session", label: "Ouvrir la conversation", enabled: true });
    expect(policy.actions.map((action) => action.id)).toEqual(["open-provider-session", "abandon"]);
  });

  it("offers manual submit to validation for an ACTIVE agent mission whose run succeeded with result text", () => {
    const policy = getMissionUiPolicy({
      mission: { id: "mission-2", projectId: null, title: "Done run", executionKind: "agent", state: "ACTIVE", version: 3, createdAt: "2026-01-01", updatedAt: "2026-01-01", runState: null, runStartedAt: null, lastAssistantMessage: null , tagIds: []},
      hasAgentConfig: true,
      latestRunId: "run-finished",
      latestRunState: "SUCCEEDED",
      hasDelivery: false,
      hasResultText: true,
      hasProviderSession: false
    });

    expect(policy.actions.map((action) => action.id)).toEqual(["submit", "open-provider-session"]);
    expect(policy.primaryAction).toMatchObject({ id: "submit", label: "Mettre en validation", enabled: true });
    expect(policy.primaryAction?.disabledReason).toBeUndefined();
  });

  it("enables manual submit for a stuck ACTIVE mission with a SUCCEEDED run but no assistant text", () => {
    const policy = getMissionUiPolicy({
      mission: { id: "mission-3", projectId: null, title: "Stuck", executionKind: "agent", state: "ACTIVE", version: 4, createdAt: "2026-01-01", updatedAt: "2026-01-01", runState: null, runStartedAt: null, lastAssistantMessage: null , tagIds: []},
      hasAgentConfig: true,
      latestRunId: "run-finished",
      latestRunState: "SUCCEEDED",
      hasDelivery: false,
      hasResultText: false,
      hasProviderSession: true
    });

    expect(policy.actions.find((action) => action.id === "submit")).toMatchObject({ enabled: true, primary: true });
    expect(policy.primaryAction?.id).toBe("submit");
  });

  it("keeps the provider conversation primary while an ACTIVE run is still running without a result", () => {
    const policy = getMissionUiPolicy({
      mission: { id: "mission-4", projectId: null, title: "Running", executionKind: "agent", state: "ACTIVE", version: 2, createdAt: "2026-01-01", updatedAt: "2026-01-01", runState: null, runStartedAt: null, lastAssistantMessage: null , tagIds: []},
      hasAgentConfig: true,
      latestRunId: "run-live",
      latestRunState: "RUNNING",
      hasDelivery: false,
      hasResultText: false,
      hasProviderSession: true
    });

    expect(policy.actions.find((action) => action.id === "submit")).toMatchObject({ enabled: false, primary: false });
    expect(policy.primaryAction).toMatchObject({ id: "open-provider-session", enabled: true });
  });

  it("enables the conversation for a pipeline ACTIVE mission with a run but no provider session", () => {
    const policy = getMissionUiPolicy({
      mission: { id: "mission-pipe-1", projectId: null, title: "Pipeline step", executionKind: "agent", state: "ACTIVE", version: 2, createdAt: "2026-01-01", updatedAt: "2026-01-01", runState: null, runStartedAt: null, lastAssistantMessage: null , tagIds: []},
      hasAgentConfig: true,
      latestRunId: "run-pipe-1",
      latestRunState: "RUNNING",
      hasDelivery: false,
      hasResultText: false,
      hasProviderSession: false
    });

    expect(policy.actions.find((action) => action.id === "open-provider-session")).toMatchObject({ enabled: true });
    expect(policy.primaryAction).toMatchObject({ id: "open-provider-session", enabled: true });
    expect(policy.primaryAction?.disabledReason).toBeUndefined();
  });

  it("enables the conversation for a DONE mission even without a run or session link", () => {
    const policy = getMissionUiPolicy({
      mission: { id: "mission-pipe-2", projectId: null, title: "Pipeline done", executionKind: "agent", state: "DONE", version: 4, createdAt: "2026-01-01", updatedAt: "2026-01-01", runState: null, runStartedAt: null, lastAssistantMessage: null , tagIds: []},
      hasAgentConfig: true,
      latestRunId: null,
      latestRunState: null,
      hasDelivery: false,
      hasResultText: false,
      hasProviderSession: false
    });

    expect(policy.primaryAction).toMatchObject({ id: "open-provider-session", enabled: true });
  });

  it("keeps the conversation disabled for a READY mission with no run and no provider session", () => {
    const policy = getMissionUiPolicy({
      mission: { id: "mission-fresh", projectId: null, title: "Fresh", executionKind: "agent", state: "READY", version: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01", runState: null, runStartedAt: null, lastAssistantMessage: null , tagIds: []},
      hasAgentConfig: true,
      latestRunId: null,
      latestRunState: null,
      hasDelivery: false,
      hasResultText: false,
      hasProviderSession: false
    });

    expect(policy.actions.find((action) => action.id === "open-provider-session")).toMatchObject({ enabled: false });
    expect(policy.primaryAction?.id).toBe("start");
  });
});
