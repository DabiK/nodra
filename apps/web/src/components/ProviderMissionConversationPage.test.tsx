// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProviderMissionConversationPage } from "./ProviderMissionConversationPage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mission = { id: "mission/provider/1", projectId: null, title: "Provider mission", executionKind: "agent", state: "ACTIVE", version: 3, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
const capability = { state: "certified", reason: null, action: null };
const control = { identity: { id: "session-1", providerId: "opencode", externalSessionRef: "thread-real", ownership: "external_observed", firstObservedAt: "2026-01-01", lastObservedAt: "2026-01-01" }, link: { id: "link-1", missionId: mission.id, mode: "control", attachedAt: "2026-01-01", detachedAt: null }, capabilities: { schemaVersion: 1, providerId: "opencode", read: capability, startTurn: capability, steer: capability, queue: { state: "unavailable", reason: "no queue", action: null } } };
const detail = { identity: control.identity, link: control.link, capabilities: { schemaVersion: 1, providerId: "opencode", listSessions: capability, readSession: capability, readHistory: capability, subscribe: capability, cursorResume: capability, attachedControl: capability }, snapshot: { session: { ref: { providerId: "opencode", externalSessionId: "thread-real" }, title: "Provider mission", cwd: "/repo", state: "active", sourceCreatedAt: null, sourceUpdatedAt: null, receivedAt: "2026-01-01" }, turns: [{ externalTurnId: "turn-active", order: 1, state: "in_progress", sourceStartedAt: null, sourceCompletedAt: null, receivedAt: "2026-01-01" }], items: [{ externalItemId: "item-a", externalTurnId: "turn-active", role: "assistant", kind: "message", order: 1, text: "Same provider text", name: null, sourceAt: null, receivedAt: "2026-01-01" }, { externalItemId: "item-b", externalTurnId: "turn-active", role: "assistant", kind: "message", order: 2, text: "Same provider text", name: null, sourceAt: null, receivedAt: "2026-01-01" }], cursor: "cursor-1" } };

function json(value: unknown) { return Promise.resolve(new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } })); }

describe("provider mission conversation", () => {
  it("activates an attached READY mission when its chat URL is opened directly", async () => {
    const readyMission = { ...mission, state: "READY", version: 1 };
    let activated = false;
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/activate") && init?.method === "POST") {
        activated = true;
        return json({ mission: { ...readyMission, state: "ACTIVE", version: 2 }, link: { ...control.link, mode: "control" } });
      }
      if (path.endsWith("/capabilities")) return json(control);
      if (path.endsWith("/provider-session")) return json({ ...detail, link: { ...detail.link, mode: activated ? "control" : "read_only" } });
      return json(activated ? { ...readyMission, state: "ACTIVE", version: 2 } : readyMission);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderMissionConversationPage missionId={readyMission.id} />);

    await screen.findByText("Provider mission");
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/activate") && init?.method === "POST")).toBe(true));
    expect(screen.getByText("CONTRÔLE ATTACHÉ")).toBeTruthy();
  });

  it("renders provider items by external identity and sends turns without a local queue", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (init?.method === "POST") return json({ ref: detail.snapshot.session.ref, externalTurnId: "turn-new" });
      if (path.endsWith("/capabilities")) return json(control);
      if (path.endsWith("/provider-session")) return json(detail);
      return json(mission);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderMissionConversationPage missionId={mission.id} />);

    await screen.findByText("Provider mission");
    expect(screen.getAllByText("Same provider text")).toHaveLength(2);
    expect(screen.getAllByText("OpenCode").length).toBeGreaterThan(0);
    expect(screen.queryByText(/queue/i)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Écris une instruction au provider…"), { target: { value: "Do the next thing" } });
    fireEvent.click(screen.getByRole("button", { name: /Envoyer un nouveau tour/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/turns") && init?.method === "POST" && JSON.parse(String(init.body)).text === "Do the next thing")).toBe(true));
  });

  it("offers steer only for an active provider session and targets its external turn id", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (init?.method === "POST") return json({ ref: detail.snapshot.session.ref, externalTurnId: "turn-active" });
      if (path.endsWith("/capabilities")) return json(control);
      if (path.endsWith("/provider-session")) return json(detail);
      return json(mission);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderMissionConversationPage missionId={mission.id} />);

    await screen.findByRole("button", { name: /Steer le tour actif/ });
    fireEvent.change(screen.getByPlaceholderText("Écris une instruction au provider…"), { target: { value: "Change direction" } });
    fireEvent.click(screen.getByRole("button", { name: /Steer le tour actif/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/steer") && JSON.parse(String(init?.body)).externalTurnId === "turn-active")).toBe(true));
  });
});
