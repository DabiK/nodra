// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTimelineQuery, loadManagerTimeline, timelineSince } from "./manager-timeline-service";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const view = {
  items: [{ id: "item-1", conversationId: "conversation-a", managerId: "manager-atlas", managerName: "Atlas", managerState: "blocked", kind: "user", body: "Vérifie mission/abc", createdAt: "2026-07-22T12:10:00.000Z" }],
  truncated: false
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("manager-timeline-service (issue #24)", () => {
  it("loads the aggregated timeline without filters", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(view)));
    await expect(loadManagerTimeline()).resolves.toEqual(view);
    expect(fetch).toHaveBeenCalledWith("/api/managers/timeline", expect.objectContaining({ cache: "no-store" }));
  });

  it("builds the query string from filters", () => {
    expect(buildTimelineQuery({})).toBe("");
    expect(buildTimelineQuery({
      managerId: "manager-atlas",
      missionId: "mission/abc",
      query: "gate release",
      since: "2026-07-01T00:00:00.000Z",
      until: "2026-07-31T00:00:00.000Z",
      limit: 50
    })).toBe("?managerId=manager-atlas&missionId=mission%2Fabc&query=gate+release&since=2026-07-01T00%3A00%3A00.000Z&until=2026-07-31T00%3A00%3A00.000Z&limit=50");
  });

  it("ignores null or empty filters", () => {
    expect(buildTimelineQuery({ managerId: null, missionId: "", query: null })).toBe("");
  });

  it("passes filters to the API call", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(view)));
    await loadManagerTimeline({ managerId: "manager-nova", query: "release" });
    expect(fetch).toHaveBeenCalledWith("/api/managers/timeline?managerId=manager-nova&query=release", expect.anything());
  });

  it("computes the since bound for each period", () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      expect(timelineSince("")).toBeNull();
      expect(timelineSince("24h")).toBe(new Date(now - 24 * 3_600_000).toISOString());
      expect(timelineSince("7d")).toBe(new Date(now - 7 * 24 * 3_600_000).toISOString());
      expect(timelineSince("30d")).toBe(new Date(now - 30 * 24 * 3_600_000).toISOString());
    } finally {
      vi.useRealTimers();
    }
  });
});
