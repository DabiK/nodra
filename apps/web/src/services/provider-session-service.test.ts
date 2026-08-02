// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachProviderSession, createProviderSessionMission, getProviderSessionCapabilities, listProviderSessions } from "./provider-session-service";

afterEach(() => vi.restoreAllMocks());

describe("provider-session service", () => {
  it("uses only the read-only attach and create endpoints with their required bodies", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    await attachProviderSession("session/a", { missionId: "mission-1", commandId: "command-a" });
    await createProviderSessionMission("session/a", { title: "Observed mission", projectId: "project-1", commandId: "command-b" });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/provider-sessions/session%2Fa/attach", expect.objectContaining({ method: "POST", body: JSON.stringify({ missionId: "mission-1", commandId: "command-a", mode: "read_only" }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/provider-sessions/session%2Fa/missions", expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "Observed mission", projectId: "project-1", commandId: "command-b", mode: "read_only" }) }));
  });

  it("scopes capability and list requests to the requested provider", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    await getProviderSessionCapabilities("opencode");
    await listProviderSessions("codex");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/provider-sessions/capabilities?providerId=opencode");
    expect(String(fetchMock.mock.calls[1][0])).toBe("/api/provider-sessions?providerId=codex&limit=40");
  });

  it("labels operation failures with the provider name", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("nope")));
    await expect(getProviderSessionCapabilities("opencode")).rejects.toThrow(/Impossible de lire les capacités OpenCode/);
    await expect(listProviderSessions("codex")).rejects.toThrow(/Impossible de charger les sessions Codex/);
  });
});
