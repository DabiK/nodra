// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadActivity, markActivityRead } from "./activity-service";

afterEach(() => vi.restoreAllMocks());

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("activity service", () => {
  it("loads the activity view from GET /api/activity", async () => {
    const payload = {
      items: [{ relayId: "relay/mission/m1", queue: "decision_required", state: "unread", reasonCode: "delivery_pending", createdAt: "2026-08-03T10:00:00.000Z", readAt: null, subject: { kind: "mission", mission: { id: "m1", title: "T", executionKind: "agent", state: "VALIDATION", updatedAt: "2026-08-03T10:00:00.000Z" } } }],
      unreadCount: 1
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadActivity()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("/api/activity", expect.anything());
  });

  it("marks an item read through POST /api/activity/:relayId/read", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await markActivityRead("relay/mission/m1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/activity/relay%2Fmission%2Fm1/read",
      expect.objectContaining({ method: "POST" })
    );
  });
});
