import { describe, expect, it } from "vitest";
import { getMissionUiPolicy } from "./mission-ui-policy";

describe("mission UI policy for provider threads", () => {
  it("opens and activates an attached READY mission instead of launching a legacy run", () => {
    const policy = getMissionUiPolicy({
      mission: { id: "mission-1", projectId: null, title: "Attached", executionKind: "agent", state: "READY", version: 2, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
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
});
