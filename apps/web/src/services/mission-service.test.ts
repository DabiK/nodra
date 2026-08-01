// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { showMission } from "./mission-service";

afterEach(() => vi.restoreAllMocks());

describe("mission service", () => {
  it("uses the lookup endpoint for mission identifiers that contain path separators", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" }
    })));
    vi.stubGlobal("fetch", fetchMock);

    await showMission("mission/provider-session/uuid");
    await showMission("mission-uuid");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/missions/lookup?missionId=mission%2Fprovider-session%2Fuuid",
      expect.anything()
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/missions/mission-uuid", expect.anything());
  });
});
