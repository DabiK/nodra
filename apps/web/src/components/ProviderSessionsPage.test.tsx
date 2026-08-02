// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProviderSessionAttachDialog } from "./ProviderSessionAttachDialog";
import { ProviderSessionsPage } from "./ProviderSessionsPage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const codexCapabilities = { schemaVersion: 1, providerId: "codex", listSessions: { state: "certified", reason: null, action: null }, readSession: { state: "certified", reason: null, action: null }, readHistory: { state: "unavailable", reason: "not used", action: null }, subscribe: { state: "unavailable", reason: "not used", action: null }, cursorResume: { state: "unavailable", reason: "not used", action: null }, attachedControl: { state: "unavailable", reason: "not used", action: null } } as const;
const opencodeCapabilities = { ...codexCapabilities, providerId: "opencode" } as const;
const codexListed = { sessions: [{ id: "session-1", summary: { ref: { providerId: "codex", externalSessionId: "thread-1" }, title: "Same text", cwd: "/repo", state: "idle", sourceCreatedAt: null, sourceUpdatedAt: "2026-01-02", receivedAt: "2026-01-01" }, link: null }, { id: "session-2", summary: { ref: { providerId: "codex", externalSessionId: "thread-codex-2" }, title: "Another session", cwd: "/other", state: "active", sourceCreatedAt: null, sourceUpdatedAt: "2026-01-01", receivedAt: "2026-01-01" }, link: null }], nextCursor: "opaque-cursor" };
const opencodeListed = { sessions: [{ id: "session-3", summary: { ref: { providerId: "opencode", externalSessionId: "thread-open-3" }, title: "Open session", cwd: "/open", state: "active", sourceCreatedAt: null, sourceUpdatedAt: "2026-01-03", receivedAt: "2026-01-01" }, link: null }], nextCursor: null };
const codexDetail = { identity: { id: "session-1", providerId: "codex", externalSessionRef: "thread-1", ownership: "external_observed", firstObservedAt: "2026-01-01", lastObservedAt: "2026-01-01" }, snapshot: { session: codexListed.sessions[0].summary, turns: [{ externalTurnId: "turn-1", order: 1, state: "completed", sourceStartedAt: null, sourceCompletedAt: null, receivedAt: "2026-01-01" }], items: [{ externalItemId: "item-1", externalTurnId: "turn-1", role: "assistant", kind: "message", order: 1, text: "Repeated observation", name: null, sourceAt: null, receivedAt: "2026-01-01" }, { externalItemId: "item-2", externalTurnId: "turn-1", role: "assistant", kind: "message", order: 2, text: "Repeated observation", name: null, sourceAt: null, receivedAt: "2026-01-01" }], cursor: "opaque-detail" }, link: null, capabilities: codexCapabilities };

function json(value: unknown) { return Promise.resolve(new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } })); }

function mockBothProviders() {
  return vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((url) => {
    const path = String(url);
    if (path.includes("capabilities")) return json(path.includes("providerId=opencode") ? opencodeCapabilities : codexCapabilities);
    if (path.includes("providerId=codex")) return json(codexListed);
    if (path.includes("providerId=opencode")) return json(opencodeListed);
    return json(codexDetail);
  });
}

describe("Provider sessions observation", () => {
  it("loads sessions from both providers with badges and selects the initial session", async () => {
    const fetchMock = mockBothProviders();
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderSessionsPage missions={[]} initialSessionId="session-1" onSessionChange={vi.fn()} onOpenMission={vi.fn()} />);
    await screen.findByRole("button", { name: "Rafraîchir" });
    expect(screen.getByText("Same text")).toBeTruthy();
    expect(screen.getByText("Another session")).toBeTruthy();
    expect(screen.getByText("Open session")).toBeTruthy();
    expect(screen.getByText("Codex · /repo")).toBeTruthy();
    expect(screen.getByText("OpenCode · /open")).toBeTruthy();
    expect(screen.getAllByText("⌁")).toHaveLength(2);
    expect(screen.getByText("◫")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Toutes 3" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Codex 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "OpenCode 1" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Session Codex" })).toBeTruthy();
  });

  it("keeps two snapshot items with identical text and refreshes explicitly", async () => {
    const fetchMock = mockBothProviders();
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderSessionsPage missions={[]} initialSessionId="session-1" onSessionChange={vi.fn()} onOpenMission={vi.fn()} />);
    await screen.findByRole("button", { name: "Rafraîchir" });
    expect(screen.getAllByText("Repeated observation")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Rafraîchir" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/refresh") && (init as RequestInit).method === "POST")).toBe(true));
  });

  it("filters the inbox by provider tab and back to all", async () => {
    vi.stubGlobal("fetch", mockBothProviders());
    render(<ProviderSessionsPage missions={[]} initialSessionId="session-1" onSessionChange={vi.fn()} onOpenMission={vi.fn()} />);
    await screen.findByRole("button", { name: "Rafraîchir" });
    fireEvent.click(screen.getByRole("button", { name: "OpenCode 1" }));
    expect(screen.getByText("Open session")).toBeTruthy();
    expect(screen.queryByText("Same text")).toBeNull();
    expect(screen.queryByText("Another session")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Toutes 3" }));
    expect(screen.getByText("Same text")).toBeTruthy();
  });

  it("filters the inbox by the external session identifier across providers", async () => {
    vi.stubGlobal("fetch", mockBothProviders());
    render(<ProviderSessionsPage missions={[]} initialSessionId="session-1" onSessionChange={vi.fn()} onOpenMission={vi.fn()} />);
    await screen.findByRole("button", { name: "Rafraîchir" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Rechercher une session" }), { target: { value: "thread-open-3" } });
    expect(screen.getByText("Open session")).toBeTruthy();
    expect(screen.queryByText("Same text")).toBeNull();
  });

  it("keeps the page alive and reports the error when one provider fails", async () => {
    vi.stubGlobal("fetch", vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((url) => {
      const path = String(url);
      if (path.includes("capabilities")) return json(path.includes("providerId=opencode") ? opencodeCapabilities : codexCapabilities);
      if (path.includes("providerId=codex")) return Promise.reject(new Error("boom"));
      if (path.includes("providerId=opencode")) return json(opencodeListed);
      return json(codexDetail);
    }));
    render(<ProviderSessionsPage missions={[]} initialSessionId="session-1" onSessionChange={vi.fn()} onOpenMission={vi.fn()} />);
    await screen.findByRole("button", { name: "Rafraîchir" });
    expect(screen.getByText("Open session")).toBeTruthy();
    expect(screen.getByText(/Impossible de charger les sessions Codex/)).toBeTruthy();
  });

  it("sends read-only attachment body and preserves a command id for a retry", async () => {
    const onAttach = vi.fn().mockResolvedValue(undefined);
    render(<ProviderSessionAttachDialog missions={[{ id: "mission-1", projectId: null, title: "Existing", executionKind: "human", state: "READY", version: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01", runState: null, runStartedAt: null, lastAssistantMessage: null }]} submitting={false} error="Réessaie" onClose={vi.fn()} onAttach={onAttach} onCreate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Lier en lecture seule" }));
    fireEvent.click(screen.getByRole("button", { name: "Lier en lecture seule" }));
    await waitFor(() => expect(onAttach).toHaveBeenCalledTimes(2));
    expect(onAttach.mock.calls[0][0]).toMatchObject({ missionId: "mission-1" });
    expect(onAttach.mock.calls[0][0].commandId).toBe(onAttach.mock.calls[1][0].commandId);
  });
});
