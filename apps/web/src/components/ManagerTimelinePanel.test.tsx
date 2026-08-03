// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { dayKey, dayLabel, groupTimelineByDay, ManagerTimelinePanel, truncateTimelineBody } from "./ManagerTimelinePanel";
import type { ManagerTimelineItemView, ManagerView, MissionView } from "../types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const at = (day: number, hour: number, minute = 0) => `2026-08-0${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;

const managers: ManagerView[] = [
  { id: "manager-atlas", name: "Atlas", state: "blocked", conversationCount: 2 } as ManagerView,
  { id: "manager-nova", name: "Nova", state: "active", conversationCount: 1 } as ManagerView
];

const missions: MissionView[] = [
  { id: "mission/abc", title: "Payer avec Stripe" } as MissionView,
  { id: "mission/def", title: "Mettre à jour le README" } as MissionView
];

const item = (overrides: Partial<ManagerTimelineItemView> = {}): ManagerTimelineItemView => ({
  id: "item-1",
  conversationId: "conversation-a",
  managerId: "manager-atlas",
  managerName: "Atlas",
  managerState: "blocked",
  kind: "user",
  body: "Vérifie la mission mission/abc",
  createdAt: at(3, 10),
  ...overrides
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderTimeline(handlers: Partial<{ onClose(): void; onOpenThread(managerId: string, threadId: string): void }> = {}) {
  return render(
    <ManagerTimelinePanel
      open
      managers={managers}
      missions={missions}
      onClose={handlers.onClose ?? vi.fn()}
      onOpenThread={handlers.onOpenThread ?? vi.fn()}
    />
  );
}

describe("ManagerTimelinePanel (issue #24)", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ManagerTimelinePanel open={false} managers={managers} missions={missions} onClose={vi.fn()} onOpenThread={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("loads the aggregated timeline and groups messages by day", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      items: [item({ id: "item-2", body: "Réponse récente", createdAt: at(3, 11) }), item()],
      truncated: false
    })));
    renderTimeline();
    expect(await screen.findByText("Aujourd'hui")).toBeTruthy();
    expect(screen.getByText("Réponse récente")).toBeTruthy();
    expect(screen.getByText("Vérifie la mission mission/abc")).toBeTruthy();
    expect(screen.getAllByText("Atlas").length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledWith("/api/managers/timeline?limit=200", expect.anything());
  });

  it("opens the source conversation with one click", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: [item()], truncated: false })));
    const onOpenThread = vi.fn();
    renderTimeline({ onOpenThread });
    fireEvent.click(await screen.findByText("Vérifie la mission mission/abc"));
    expect(onOpenThread).toHaveBeenCalledWith("manager-atlas", "conversation-a");
  });

  it("filters by manager", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: [], truncated: false })));
    renderTimeline();
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "manager-nova" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/managers/timeline?managerId=manager-nova&limit=200", expect.anything()));
  });

  it("filters by mission mention", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: [], truncated: false })));
    renderTimeline();
    fireEvent.change(screen.getByLabelText("Mission mentionnée"), { target: { value: "mission/abc" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("missionId=mission%2Fabc"), expect.anything()));
  });

  it("filters by period with a since bound", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: [], truncated: false })));
    renderTimeline();
    fireEvent.change(screen.getByLabelText("Période"), { target: { value: "7d" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("since="), expect.anything()));
  });

  it("searches by keyword with a debounce", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: [], truncated: false })));
    renderTimeline();
    fireEvent.change(screen.getByLabelText("Rechercher dans les messages des managers"), { target: { value: "release" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/managers/timeline?query=release&limit=200", expect.anything()));
  });

  it("shows an empty state and a truncated hint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: [], truncated: false })));
    renderTimeline();
    expect(await screen.findByText(/Aucun message de manager\./)).toBeTruthy();
  });

  it("closes on Escape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: [item()], truncated: false })));
    const onClose = vi.fn();
    renderTimeline({ onClose });
    await screen.findByText("Vérifie la mission mission/abc");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on backdrop click", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: [item()], truncated: false })));
    const onClose = vi.fn();
    const { container } = renderTimeline({ onClose });
    await screen.findByText("Vérifie la mission mission/abc");
    fireEvent.mouseDown(container.querySelector(".manager-timeline-backdrop") as Element);
    expect(onClose).toHaveBeenCalled();
  });

  it("reports loading failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "boom" }, 500)));
    renderTimeline();
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("timeline helpers", () => {
  it("extracts the day key and labels today / yesterday / dates", () => {
    expect(dayKey(at(3, 10))).toBe("2026-08-03");
    const now = new Date("2026-08-03T18:00:00.000Z");
    expect(dayLabel("2026-08-03", now)).toBe("Aujourd'hui");
    expect(dayLabel("2026-08-02", now)).toBe("Hier");
    expect(dayLabel("2026-07-15", now)).toMatch(/15/);
  });

  it("groups chronological items by day, preserving order", () => {
    const groups = groupTimelineByDay([
      item({ id: "a1", createdAt: at(3, 12) }),
      item({ id: "a2", createdAt: at(3, 9) }),
      item({ id: "b1", createdAt: at(2, 12) })
    ]);
    expect(groups.map((group) => group.day)).toEqual(["2026-08-03", "2026-08-02"]);
    expect(groups[0].items.map((item) => item.id)).toEqual(["a1", "a2"]);
  });

  it("truncates long bodies and keeps short ones", () => {
    expect(truncateTimelineBody(null)).toBe("—");
    expect(truncateTimelineBody("court")).toBe("court");
    expect(truncateTimelineBody("x".repeat(300))).toHaveLength(281);
    expect(truncateTimelineBody("x".repeat(300)).endsWith("…")).toBe(true);
  });
});
