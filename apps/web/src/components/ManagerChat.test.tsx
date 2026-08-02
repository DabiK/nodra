// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ManagerChat } from "./ManagerChat";
import type { ManagerConversationView, ManagerThreadView, ManagerView } from "../types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// jsdom n'implémente ni scrollIntoView ni scrollTo ; la recherche et
// l'auto-scroll du fil les utilisent.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
});

const manager: ManagerView = {
  id: "manager/1",
  projectId: null,
  name: "Guild Master",
  instruction: "Orchestre les missions.",
  state: "ready",
  providerId: "opencode",
  modelId: "openai/gpt-5",
  reasoningEffort: "high",
  permissionPreset: "workspace",
  workspaceId: null,
  workspacePath: null,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  archivedAt: null,
  activeRunId: null,
  currentThreadId: "t1",
  lastMessage: null,
  conversationCount: 1
};

const conversation: ManagerConversationView = {
  id: "t1",
  managerId: manager.id,
  createdAt: "2026-01-01",
  current: true,
  providerSessionRef: null,
  threadId: "t1",
  turns: [{ runId: "r1", state: "COMPLETED", createdAt: "2026-01-01", endedAt: "2026-01-01", summary: "Premier brief" }]
};

const thread: ManagerThreadView = {
  manager,
  conversation: { id: "t1", providerSessionRef: null, state: "idle" },
  run: {
    id: "r1",
    missionId: null,
    conversationId: "t1",
    state: "COMPLETED",
    providerId: "opencode",
    modelId: "openai/gpt-5",
    reasoningEffort: "high",
    providerRunRef: null,
    createdAt: "2026-01-01",
    startedAt: "2026-01-01",
    endedAt: "2026-01-01",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costMicros: 100
  },
  config: { promptEffective: "brief", promptManagerInstruction: "instruction", cwd: "/repo", permissionPreset: "workspace" },
  items: [
    { id: "i1", kind: "user", body: "Prépare la release", createdAt: "2026-01-01" },
    { id: "i2", kind: "assistant", body: "La release est prête", createdAt: "2026-01-01" },
    { id: "i3", kind: "tool", body: "git commit -m release", createdAt: "2026-01-01" }
  ],
  events: [],
  threadId: "t1"
};

function json(value: unknown) {
  return Promise.resolve(new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }));
}

function renderChat() {
  const fetchMock = vi.fn((url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/conversations")) return json([conversation]);
    if (path.endsWith("/threads/t1")) return json(thread);
    return json(null);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<ManagerChat manager={manager} onBack={vi.fn()} onChanged={vi.fn()} />);
  return fetchMock;
}

describe("ManagerChat", () => {
  it("renders the thread items of the loaded conversation", async () => {
    renderChat();
    expect(await screen.findByText("La release est prête")).toBeTruthy();
    expect(screen.getByText("Prépare la release")).toBeTruthy();
    expect(screen.getByText("git commit -m release")).toBeTruthy();
    expect(screen.getByText("Afficher la sortie")).toBeTruthy();
  });

  it("searches the thread, highlights matches and navigates between occurrences", async () => {
    renderChat();
    await screen.findByText("La release est prête");

    fireEvent.click(screen.getByRole("button", { name: "Rechercher dans la conversation" }));
    const searchbox = screen.getByRole("searchbox");
    fireEvent.change(searchbox, { target: { value: "release" } });

    // Trois occurrences : message user, message assistant, sortie du tool call.
    expect((await screen.findByRole("status", { name: "Occurrences" })).textContent).toBe("1 / 3");
    expect(document.querySelectorAll("mark.conversation-search-hit")).toHaveLength(3);
    const targets = document.querySelectorAll("[data-search-id]");
    expect(targets[0].classList.contains("conversation-search-current")).toBe(true);

    // Entrée navigue vers l'occurrence suivante, avec bouclage.
    fireEvent.keyDown(searchbox, { key: "Enter" });
    expect(screen.getByRole("status", { name: "Occurrences" }).textContent).toBe("2 / 3");
    expect(targets[1].classList.contains("conversation-search-current")).toBe(true);
    fireEvent.keyDown(searchbox, { key: "Enter" });
    fireEvent.keyDown(searchbox, { key: "Enter" });
    expect(screen.getByRole("status", { name: "Occurrences" }).textContent).toBe("1 / 3");

    // Échap ferme la barre et efface la recherche.
    fireEvent.keyDown(searchbox, { key: "Escape" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(document.querySelectorAll("mark.conversation-search-hit")).toHaveLength(0);
  });

  it("highlights the output of a tool call event", async () => {
    renderChat();
    await screen.findByText("La release est prête");

    fireEvent.click(screen.getByRole("button", { name: "Rechercher dans la conversation" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "git commit" } });
    expect((await screen.findByRole("status", { name: "Occurrences" })).textContent).toBe("1 / 1");
    const pre = document.querySelector(".manager-tool-details pre");
    expect(pre?.querySelectorAll("mark.conversation-search-hit")).toHaveLength(1);
    expect(pre?.querySelector("mark")?.textContent).toBe("git commit");
  });

  it("reports no result when the query matches nothing", async () => {
    renderChat();
    await screen.findByText("La release est prête");

    fireEvent.click(screen.getByRole("button", { name: "Rechercher dans la conversation" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "introuvable" } });
    expect((await screen.findByRole("status", { name: "Occurrences" })).textContent).toBe("Aucun résultat");
  });

  it("keeps the context-loss banner hidden for a short conversation", async () => {
    renderChat();
    await screen.findByText("La release est prête");
    expect(screen.queryByText(/risque de perte de contexte/)).toBeNull();
  });

  it("warns about context loss for a long conversation with its metrics", async () => {
    const longConversation: ManagerConversationView = {
      ...conversation,
      turns: Array.from({ length: 30 }, (_, index) => ({
        runId: `r${index}`,
        state: "COMPLETED",
        createdAt: "2026-01-01",
        endedAt: "2026-01-01",
        summary: `Brief ${index}`
      }))
    };
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith("/conversations")) return json([longConversation]);
      if (path.endsWith("/threads/t1")) return json(thread);
      return json(null);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ManagerChat manager={manager} onBack={vi.fn()} onChanged={vi.fn()} />);

    expect(await screen.findByText("⚠ Conversation longue — risque de perte de contexte")).toBeTruthy();
    expect(screen.getByText("30 tours · ≈ 150 tokens rapportés")).toBeTruthy();
    expect(screen.getByText("Nombre de tours élevé")).toBeTruthy();
  });

  it("starts a new conversation from the banner action", async () => {
    const longConversation: ManagerConversationView = {
      ...conversation,
      turns: Array.from({ length: 30 }, (_, index) => ({
        runId: `r${index}`,
        state: "COMPLETED",
        createdAt: "2026-01-01",
        endedAt: "2026-01-01",
        summary: `Brief ${index}`
      }))
    };
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith("/conversations")) return json([longConversation]);
      if (path.endsWith("/threads/t1")) return json(thread);
      return json(null);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ManagerChat manager={manager} onBack={vi.fn()} onChanged={vi.fn()} />);

    await screen.findByText("⚠ Conversation longue — risque de perte de contexte");
    fireEvent.click(screen.getByRole("button", { name: "＋ Nouveau fil" }));

    expect(await screen.findByRole("heading", { name: "Nouvelle conversation" })).toBeTruthy();
    expect(screen.queryByText(/risque de perte de contexte/)).toBeNull();
  });
});
