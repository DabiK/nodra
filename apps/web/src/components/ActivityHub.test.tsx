// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActivityHub, formatActivityTime, reasonLabel, REASON_LABELS } from "./ActivityHub";
import type { ActivityItem, ActivityView } from "../services/activity-service";

afterEach(cleanup);

const missionItem = (overrides: Partial<ActivityItem> = {}): ActivityItem => ({
  relayId: "relay/mission/m1",
  queue: "decision_required",
  state: "unread",
  reasonCode: "delivery_pending",
  createdAt: "2026-08-03T10:00:00.000Z",
  readAt: null,
  subject: {
    kind: "mission",
    mission: { id: "m1", title: "Payer avec Stripe", executionKind: "agent", state: "VALIDATION", updatedAt: "2026-08-03T10:00:00.000Z" }
  },
  ...overrides
});

const pipelineItem = (overrides: Partial<ActivityItem> = {}): ActivityItem => ({
  relayId: "relay/pipeline/run-1",
  queue: "decision_required",
  state: "unread",
  reasonCode: "pipeline_transition_requires_human",
  createdAt: "2026-08-03T09:00:00.000Z",
  readAt: null,
  subject: { kind: "pipeline", pipelineId: "pipeline-1", pipelineName: "Release" },
  ...overrides
});

const blockedItem = (overrides: Partial<ActivityItem> = {}): ActivityItem => ({
  relayId: "relay/mission/m2",
  queue: "blocked",
  state: "unread",
  reasonCode: "Attente produit",
  createdAt: "2026-08-03T08:00:00.000Z",
  readAt: null,
  subject: {
    kind: "mission",
    mission: { id: "m2", title: "Mettre à jour le README", executionKind: "human", state: "BLOCKED", updatedAt: "2026-08-03T08:00:00.000Z" }
  },
  ...overrides
});

function renderHub(activity: ActivityView | null, handlers: Partial<{
  onClose(): void;
  onOpenMission(missionId: string): void;
  onOpenPipeline(pipelineId: string): void;
  onMarkRead(relayId: string): void;
  onMarkAllRead(): void;
}> = {}) {
  render(
    <ActivityHub
      open
      activity={activity}
      onClose={handlers.onClose ?? vi.fn()}
      onOpenMission={handlers.onOpenMission ?? vi.fn()}
      onOpenPipeline={handlers.onOpenPipeline ?? vi.fn()}
      onMarkRead={handlers.onMarkRead ?? vi.fn()}
      onMarkAllRead={handlers.onMarkAllRead ?? vi.fn()}
    />
  );
}

describe("ActivityHub", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ActivityHub
        open={false}
        activity={null}
        onClose={vi.fn()}
        onOpenMission={vi.fn()}
        onOpenPipeline={vi.fn()}
        onMarkRead={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows an empty state when nothing awaits a decision", () => {
    renderHub({ items: [], unreadCount: 0 });
    expect(screen.getByText(/Rien à traiter/)).toBeTruthy();
  });

  it("groups items by queue with titles, labels and read state", () => {
    renderHub({
      items: [missionItem(), blockedItem()],
      unreadCount: 2
    });
    expect(screen.getByText("Décision requise · 1")).toBeTruthy();
    expect(screen.getByText("Bloquées · 1")).toBeTruthy();
    expect(screen.getByText("Payer avec Stripe")).toBeTruthy();
    expect(screen.getByText(REASON_LABELS.delivery_pending)).toBeTruthy();
    expect(screen.getByText("Mettre à jour le README")).toBeTruthy();
    expect(screen.getByText("Bloquée — Attente produit")).toBeTruthy();
    // 2 items non lus → 2 boutons « Lu », 1 bouton « Tout marquer lu ».
    expect(screen.getAllByRole("button", { name: /Marquer comme lu/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Tout marquer lu/ })).toBeTruthy();
  });

  it("reports the unread count in the summary and offers mark-all only when unread", () => {
    renderHub({ items: [missionItem()], unreadCount: 1 });
    expect(screen.getByText(/1 décision humaine à traiter/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Tout marquer lu/ })).toBeTruthy();
  });

  it("hides mark-all when everything is read and marks the item as read", () => {
    renderHub({ items: [missionItem({ state: "read", readAt: "2026-08-03T11:00:00.000Z" })], unreadCount: 0 });
    expect(screen.getByText(/Aucune décision en attente/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Tout marquer lu/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Marquer comme lu/ })).toBeNull();
    expect(screen.getByText(/· lu/)).toBeTruthy();
  });

  it("opens the mission fiche when clicking a mission item", () => {
    const onOpenMission = vi.fn();
    renderHub({ items: [missionItem()], unreadCount: 1 }, { onOpenMission });
    fireEvent.click(screen.getByText("Payer avec Stripe"));
    expect(onOpenMission).toHaveBeenCalledWith("m1");
  });

  it("opens the pipeline when clicking a pipeline item", () => {
    const onOpenPipeline = vi.fn();
    renderHub({ items: [pipelineItem()], unreadCount: 1 }, { onOpenPipeline });
    fireEvent.click(screen.getByText("Release"));
    expect(onOpenPipeline).toHaveBeenCalledWith("pipeline-1");
  });

  it("marks a single item read without opening the subject", () => {
    const onMarkRead = vi.fn();
    const onOpenMission = vi.fn();
    renderHub({ items: [missionItem()], unreadCount: 1 }, { onMarkRead, onOpenMission });
    fireEvent.click(screen.getByRole("button", { name: /Marquer comme lu : Payer avec Stripe/ }));
    expect(onMarkRead).toHaveBeenCalledWith("relay/mission/m1");
    expect(onOpenMission).not.toHaveBeenCalled();
  });

  it("marks everything read through mark-all", () => {
    const onMarkAllRead = vi.fn();
    renderHub({ items: [missionItem(), pipelineItem()], unreadCount: 2 }, { onMarkAllRead });
    fireEvent.click(screen.getByRole("button", { name: /Tout marquer lu/ }));
    expect(onMarkAllRead).toHaveBeenCalledTimes(1);
  });

  it("closes through the close button and the backdrop", () => {
    const onClose = vi.fn();
    renderHub({ items: [missionItem()], unreadCount: 1 }, { onClose });
    fireEvent.click(screen.getByRole("button", { name: "Fermer le hub d'activité" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("formats activity times in French relative labels", () => {
    const now = new Date("2026-08-03T12:00:00.000Z");
    expect(formatActivityTime("2026-08-03T11:59:30.000Z", now)).toBe("à l'instant");
    expect(formatActivityTime("2026-08-03T11:30:00.000Z", now)).toBe("il y a 30 min");
    expect(formatActivityTime("2026-08-03T09:00:00.000Z", now)).toBe("il y a 3 h");
    expect(formatActivityTime("2026-08-01T09:00:00.000Z", now)).toMatch(/\d{2}/);
  });

  it("labels unknown reason codes with the raw code for decision items", () => {
    expect(reasonLabel(missionItem({ reasonCode: "some_new_reason" }))).toBe("some_new_reason");
    expect(reasonLabel(blockedItem({ reasonCode: "raison libre" }))).toBe("Bloquée — raison libre");
  });
});
