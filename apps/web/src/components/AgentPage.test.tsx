// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { AgentPage } from "./AgentPage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mission = { id: "mission/provider/1", projectId: null, title: "Provider mission", executionKind: "agent", state: "ACTIVE", version: 3, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
const otherMission = { ...mission, id: "mission/provider/2", title: "Other mission", state: "READY", updatedAt: "2026-01-02" };
const capability = { state: "certified", reason: null, action: null };
const control = { identity: { id: "session-1", providerId: "opencode", externalSessionRef: "thread-real", ownership: "external_observed", firstObservedAt: "2026-01-01", lastObservedAt: "2026-01-01" }, link: { id: "link-1", missionId: mission.id, mode: "control", attachedAt: "2026-01-01", detachedAt: null }, capabilities: { schemaVersion: 1, providerId: "opencode", read: capability, startTurn: capability, steer: capability, queue: { state: "unavailable", reason: "no queue", action: null } } };
const detail = { identity: control.identity, link: control.link, capabilities: { schemaVersion: 1, providerId: "opencode", listSessions: capability, readSession: capability, readHistory: capability, subscribe: capability, cursorResume: capability, attachedControl: capability }, snapshot: { session: { ref: { providerId: "opencode", externalSessionId: "thread-real" }, title: "Provider mission", cwd: "/repo", state: "active", sourceCreatedAt: null, sourceUpdatedAt: null, receivedAt: "2026-01-01" }, turns: [{ externalTurnId: "turn-active", order: 1, state: "in_progress", sourceStartedAt: null, sourceCompletedAt: null, receivedAt: "2026-01-01" }], items: [{ externalItemId: "item-a", externalTurnId: "turn-active", role: "tool", kind: "tool_result", order: 1, text: "ls -la", name: "exec", sourceAt: null, receivedAt: "2026-01-01" }], cursor: "cursor-1" } };

function json(value: unknown) { return Promise.resolve(new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } })); }

describe("AgentPage", () => {
  it("renders the sidebar shell with active missions next to the provider conversation", async () => {
    window.history.replaceState({}, "", "/agent.html?missionId=mission%2Fprovider%2F1");
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path === "/api/missions") return json([mission, otherMission]);
      if (path.endsWith("/capabilities")) return json(control);
      if (path.endsWith("/provider-session")) return json(detail);
      return json(mission);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AgentPage />);

    expect(screen.getByRole("navigation")).toBeTruthy();
    expect(screen.getByText("Flux · Tâches")).toBeTruthy();

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/missions")).toBe(true));
    expect(await screen.findByLabelText("Missions actives")).toBeTruthy();
    expect(screen.queryByText("Other mission")).toBeNull();

    await waitFor(() => expect(screen.getAllByText("Provider mission").length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText("exec")).toBeTruthy();
    expect(screen.getByText("ls -la")).toBeTruthy();
  });

  it("shows only running missions in the sidebar despite recent non-terminal missions", async () => {
    window.history.replaceState({}, "", "/agent.html?missionId=mission%2Fprovider%2F1");
    const oldActive = { ...mission, state: "ACTIVE", updatedAt: "2026-01-01" };
    const recent = Array.from({ length: 10 }, (_, index) => ({
      ...otherMission,
      id: `mission/provider/recent-${index}`,
      title: `Recent mission ${index}`,
      state: "DRAFT",
      updatedAt: `2026-02-${String(index + 1).padStart(2, "0")}`
    }));
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path === "/api/missions") return json([oldActive, ...recent]);
      if (path.endsWith("/capabilities")) return json(control);
      if (path.endsWith("/provider-session")) return json(detail);
      return json(oldActive);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AgentPage />);

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/missions")).toBe(true));
    expect(await screen.findByLabelText("Missions actives")).toBeTruthy();
    expect(screen.getAllByText("Provider mission").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Recent mission 9")).toBeNull();
  });
});
