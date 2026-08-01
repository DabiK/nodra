import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activateMissionProviderSession,
  loadMissionProviderSession,
  loadMissionProviderSessionCapabilities,
  startMissionProviderTurn,
  steerMissionProviderTurn
} from "./mission-provider-session-service";

afterEach(() => vi.restoreAllMocks());

function response() {
  return Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
}

describe("mission provider-session service", () => {
  it("encodes mission ids and preserves the stabilized command bodies", async () => {
    const fetchMock = vi.fn(response);
    vi.stubGlobal("fetch", fetchMock);

    await loadMissionProviderSession("mission/provider/1");
    await loadMissionProviderSessionCapabilities("mission/provider/1");
    await activateMissionProviderSession("mission/provider/1", 4, "activate-1");
    await startMissionProviderTurn("mission/provider/1", "Next step", "turn-1");
    await steerMissionProviderTurn("mission/provider/1", "external-turn", "Adjust", "steer-1");

    const base = "/api/missions/mission%2Fprovider%2F1/provider-session";
    expect(fetchMock).toHaveBeenNthCalledWith(1, base, expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${base}/capabilities`, expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(3, `${base}/activate`, expect.objectContaining({ method: "POST", body: JSON.stringify({ expectedVersion: 4, commandId: "activate-1" }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, `${base}/turns`, expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "Next step", commandId: "turn-1" }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(5, `${base}/steer`, expect.objectContaining({ method: "POST", body: JSON.stringify({ externalTurnId: "external-turn", text: "Adjust", commandId: "steer-1" }) }));
  });
});
