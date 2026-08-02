// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProviderMissionConversationPage } from "./ProviderMissionConversationPage";

// La suppression d'écho SSE est testée en isolation (events-service.test.ts) :
// ici on la neutralise pour vérifier que la garde côté composant empêche
// elle-même la boucle (POST → event → refresh → POST…).
vi.mock("../services/events-service", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, suppressServerEventsFor: vi.fn() };
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// jsdom n'implémente pas scrollIntoView ; la recherche l'utilise pour
// amener l'occurrence active dans la vue.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const mission = { id: "mission/provider/1", projectId: null, title: "Provider mission", executionKind: "agent", state: "ACTIVE", version: 3, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
const capability = { state: "certified", reason: null, action: null };
const control = { identity: { id: "session-1", providerId: "opencode", externalSessionRef: "thread-real", ownership: "external_observed", firstObservedAt: "2026-01-01", lastObservedAt: "2026-01-01" }, link: { id: "link-1", missionId: mission.id, mode: "control", attachedAt: "2026-01-01", detachedAt: null }, capabilities: { schemaVersion: 1, providerId: "opencode", read: capability, startTurn: capability, steer: capability, queue: { state: "unavailable", reason: "no queue", action: null } } };
const detail = { identity: control.identity, link: control.link, capabilities: { schemaVersion: 1, providerId: "opencode", listSessions: capability, readSession: capability, readHistory: capability, subscribe: capability, cursorResume: capability, attachedControl: capability }, snapshot: { session: { ref: { providerId: "opencode", externalSessionId: "thread-real" }, title: "Provider mission", cwd: "/repo", state: "active", sourceCreatedAt: null, sourceUpdatedAt: null, receivedAt: "2026-01-01" }, turns: [{ externalTurnId: "turn-active", order: 1, state: "in_progress", sourceStartedAt: null, sourceCompletedAt: null, receivedAt: "2026-01-01" }], items: [{ externalItemId: "item-a", externalTurnId: "turn-active", role: "assistant", kind: "message", order: 1, text: "Same provider text", name: null, sourceAt: null, receivedAt: "2026-01-01" }, { externalItemId: "item-b", externalTurnId: "turn-active", role: "assistant", kind: "message", order: 2, text: "Same provider text", name: null, sourceAt: null, receivedAt: "2026-01-01" }, { externalItemId: "item-subagent", externalTurnId: "turn-active", role: "assistant", kind: "subagent", order: 3, text: "started", name: "nested/codex", sourceAt: null, receivedAt: "2026-01-01" }], cursor: "cursor-1" } };
const catalog = {
  providers: [
    {
      id: "opencode", label: "OpenCode", status: "ready", reason: null,
      models: [
        { id: "openai/gpt-5", label: "OpenAI / GPT-5", description: "", hidden: false, isDefault: true, supportedReasoningEfforts: ["provider_default", "low", "high"], defaultReasoningEffort: "provider_default" },
        { id: "anthropic/claude-sonnet", label: "Anthropic / Claude Sonnet", description: "", hidden: false, isDefault: false, supportedReasoningEfforts: ["provider_default"], defaultReasoningEffort: "provider_default" }
      ]
    },
    { id: "codex", label: "Codex", status: "ready", reason: null, models: [] }
  ],
  reasoningEfforts: ["provider_default", "minimal", "low", "medium", "high", "xhigh"],
  permissionPresets: ["read_only", "workspace", "full_access"],
  defaults: { providerId: "opencode", modelId: "openai/gpt-5", reasoningEffort: "provider_default", permissionPreset: "workspace", providerOptions: { schemaVersion: 1, value: {} } }
};

function json(value: unknown) { return Promise.resolve(new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } })); }

function fetchWithCatalog(handlers: (url: RequestInfo | URL, init?: RequestInit) => ReturnType<typeof json> | Promise<Response>, catalogValue = catalog) {
  return vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/providers/options")) return json(catalogValue);
    return handlers(url, init);
  });
}

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
    expect(screen.getByText("Sous-agent")).toBeTruthy();
    expect(screen.getByText("nested/codex")).toBeTruthy();
    expect(screen.getByText("Démarré")).toBeTruthy();
    expect(screen.queryByText("started")).toBeNull();

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

  it("falls back to a clean pending state when a READY mission has no provider session to activate", async () => {
    const missing = () => Promise.resolve(new Response(JSON.stringify({ message: "Mission mission/provider/1 has no active provider session", code: "MISSION_PROVIDER_SESSION_NOT_FOUND" }), { status: 404, headers: { "content-type": "application/json" } }));
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/activate") && init?.method === "POST") return missing();
      if (path.endsWith("/provider-session")) return missing();
      if (path.endsWith("/ensure-observation") && init?.method === "POST") return json({ ...mission, state: "READY", version: 1 });
      if (path.endsWith("/capabilities")) return missing();
      return json({ ...mission, state: "READY", version: 1 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderMissionConversationPage missionId={mission.id} />);

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/ensure-observation") && init?.method === "POST")).toBe(true));
    expect(await screen.findByText(/Lance d'abord la mission/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not re-POST ensure-observation on SSE echoes (no infinite polling loop)", async () => {
    const missing = () => Promise.resolve(new Response(JSON.stringify({ message: "Mission mission/provider/1 has no active provider session", code: "MISSION_PROVIDER_SESSION_NOT_FOUND" }), { status: 404, headers: { "content-type": "application/json" } }));
    let ensureCalls = 0;
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/activate") && init?.method === "POST") return missing();
      if (path.endsWith("/provider-session")) return missing();
      if (path.endsWith("/ensure-observation") && init?.method === "POST") { ensureCalls += 1; return json({ ...mission, state: "READY", version: 1 }); }
      if (path.endsWith("/capabilities")) return missing();
      return json({ ...mission, state: "READY", version: 1 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const listeners: Array<(message: MessageEvent<string>) => void> = [];
    class FakeEventSource {
      constructor(_url: string) { /* registre partagé */ }
      addEventListener(_type: string, callback: (message: MessageEvent<string>) => void): void {
        listeners.push(callback);
      }
      close(): void { /* no-op */ }
    }
    vi.stubGlobal("EventSource", FakeEventSource);

    render(<ProviderMissionConversationPage missionId={mission.id} />);
    await waitFor(() => expect(ensureCalls).toBe(1));
    expect(await screen.findByText(/Lance d'abord la mission/)).toBeTruthy();

    const dispatch = () => {
      const event = new MessageEvent("message", { data: JSON.stringify({ type: "data_changed", source: "database" }) });
      for (const listener of listeners) listener(event);
    };
    await act(async () => {
      dispatch();
      dispatch();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Les échos SSE n'ont pas re-déclenché le POST : la boucle est cassée.
    expect(ensureCalls).toBe(1);
  });

  it("falls back to an observation session for an ACTIVE mission without a provider session link", async () => {
    const readOnlyDetail = { ...detail, link: { ...detail.link, mode: "read_only" } };
    let ensured = false;
    const missing = () => Promise.resolve(new Response(JSON.stringify({ message: "Mission mission/provider/1 has no active provider session", code: "MISSION_PROVIDER_SESSION_NOT_FOUND" }), { status: 404, headers: { "content-type": "application/json" } }));
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/ensure-observation") && init?.method === "POST") {
        ensured = true;
        return json(readOnlyDetail);
      }
      if (path.endsWith("/capabilities")) return json(control);
      if (path.endsWith("/provider-session")) return ensured ? json(readOnlyDetail) : missing();
      return json(mission);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderMissionConversationPage missionId={mission.id} />);

    expect(await screen.findByText("OBSERVATION + ENVOI")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a thinking bubble with the provider label while a turn is active", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (init?.method === "POST") return json({ ref: detail.snapshot.session.ref, externalTurnId: "turn-active" });
      if (path.endsWith("/capabilities")) return json(control);
      if (path.endsWith("/provider-session")) return json(detail);
      return json(mission);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderMissionConversationPage missionId={mission.id} />);

    await screen.findByText("Provider mission");
    expect(screen.getByRole("status", { name: /OpenCode r\u00e9fl\u00e9chit/ })).toBeTruthy();
  });

  it("hides the thinking bubble when no turn is active", async () => {
    const completed = { ...detail, snapshot: { ...detail.snapshot, turns: detail.snapshot.turns.map((turn) => ({ ...turn, state: "completed" })) } };
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (init?.method === "POST") return json({ ref: detail.snapshot.session.ref, externalTurnId: "turn-active" });
      if (path.endsWith("/capabilities")) return json(control);
      if (path.endsWith("/provider-session")) return json(completed);
      return json(mission);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderMissionConversationPage missionId={mission.id} />);

    await screen.findByText("Provider mission");
    expect(screen.queryByRole("status", { name: /r\u00e9fl\u00e9chit/ })).toBeNull();
  });

  it("clears the composer and echoes the message in a pending bubble while the turn syncs", async () => {
    let release: ((value: unknown) => void) | undefined;
    const gate = new Promise((resolve) => { release = resolve; });
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (init?.method === "POST") return gate.then(() => json({ ref: detail.snapshot.session.ref, externalTurnId: "turn-new" }));
      if (path.endsWith("/capabilities")) return json(control);
      if (path.endsWith("/provider-session")) return json(detail);
      return json(mission);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderMissionConversationPage missionId={mission.id} />);

    await screen.findByText("Provider mission");
    const input = screen.getByPlaceholderText("Écris une instruction au provider…") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Do the next thing" } });
    fireEvent.click(screen.getByRole("button", { name: /Envoyer un nouveau tour/ }));

    expect(screen.getByRole("status", { name: "Message envoyé" })).toBeTruthy();
    expect(within(screen.getByRole("status", { name: "Message envoyé" })).getByText("Do the next thing")).toBeTruthy();
    expect(screen.getByText(/envoi en cours/)).toBeTruthy();
    release!(null);
    await waitFor(() => expect(input.value).toBe(""));
    await waitFor(() => expect(screen.queryByRole("status", { name: "Message envoyé" })).toBeNull());
  });

  it("keeps the composer text when sending fails", async () => {
    const fail = () => Promise.reject(new Error("provider unreachable"));
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (init?.method === "POST") return fail();
      if (path.endsWith("/capabilities")) return json(control);
      if (path.endsWith("/provider-session")) return json(detail);
      return json(mission);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderMissionConversationPage missionId={mission.id} />);

    await screen.findByText("Provider mission");
    const input = screen.getByPlaceholderText("Écris une instruction au provider…") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Do the next thing" } });
    fireEvent.click(screen.getByRole("button", { name: /Envoyer un nouveau tour/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(input.value).toBe("Do the next thing");
    expect(screen.queryByRole("status", { name: "Message envoyé" })).toBeNull();
  });

  it("offers model and reasoning controls bound to the session provider and applies them to the next turn", async () => {
    const fetchMock = fetchWithCatalog((url, init) => {
      const path = String(url);
      if (init?.method === "POST") return json({ ref: detail.snapshot.session.ref, externalTurnId: "turn-new" });
      if (path.endsWith("/capabilities")) return json(control);
      if (path.endsWith("/provider-session")) return json(detail);
      return json(mission);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderMissionConversationPage missionId={mission.id} />);

    await screen.findByText("Provider mission");
    await screen.findByLabelText("Niveau de réflexion du prochain tour");

    const providerSelect = screen.getByLabelText("Provider lié à la session") as HTMLSelectElement;
    expect(providerSelect.value).toBe("opencode");
    expect(([...providerSelect.options].find((option) => !option.disabled)!).value).toBe("opencode");

    fireEvent.change(screen.getByLabelText("Niveau de réflexion du prochain tour"), { target: { value: "high" } });
    fireEvent.change(screen.getByPlaceholderText("Écris une instruction au provider…"), { target: { value: "Do the next thing" } });
    fireEvent.click(screen.getByRole("button", { name: /Envoyer un nouveau tour/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => {
      if (!String(url).endsWith("/turns") || init?.method !== "POST") return false;
      const body = JSON.parse(String(init.body));
      return body.text === "Do the next thing" && body.modelId === "openai/gpt-5" && body.reasoningEffort === "high";
    })).toBe(true));
  });

  it("enhances the prompt in one shot with a chosen provider and model, then fills the composer", async () => {
    const fetchMock = fetchWithCatalog((url, init) => {
      const path = String(url);
      if (path.endsWith("/llm/enhance") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body.providerId).toBe("opencode");
        expect(body.modelId).toBe("openai/gpt-5");
        expect(body.prompt).toBe("Do the next thing");
        return json({ prompt: "Enhanced prompt with much more detail." });
      }
      if (init?.method === "POST") return json({ ref: detail.snapshot.session.ref, externalTurnId: "turn-new" });
      if (path.endsWith("/capabilities")) return json(control);
      if (path.endsWith("/provider-session")) return json(detail);
      return json(mission);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderMissionConversationPage missionId={mission.id} />);

    await screen.findByText("Provider mission");
    const input = screen.getByPlaceholderText("Écris une instruction au provider…") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Do the next thing" } });
    fireEvent.click(screen.getByRole("button", { name: /Améliorer/ }));

    expect(await screen.findByRole("heading", { name: "Améliorer le prompt" })).toBeTruthy();
    expect((screen.getByLabelText("Moteur") as HTMLSelectElement).value).toBe("opencode");
    fireEvent.click(screen.getByRole("button", { name: /Améliorer le prompt/ }));

    await waitFor(() => expect(input.value).toBe("Enhanced prompt with much more detail."));
    expect(screen.queryByRole("heading", { name: "Améliorer le prompt" })).toBeNull();
  });

  it("searches the thread, highlights matches and navigates between occurrences", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: /Rechercher/ }));
    const searchbox = screen.getByRole("searchbox");
    fireEvent.change(searchbox, { target: { value: "Same" } });

    // Deux occurrences (une par message), compteur affiché, surlignage en place.
    expect((await screen.findByRole("status", { name: "Occurrences" })).textContent).toBe("1 / 2");
    expect(document.querySelectorAll("mark.conversation-search-hit")).toHaveLength(2);
    const articles = document.querySelectorAll("article.provider-thread-item");
    expect(articles[0].classList.contains("conversation-search-current")).toBe(true);
    expect(articles[1].classList.contains("conversation-search-current")).toBe(false);

    // Entrée passe à l'occurrence suivante.
    fireEvent.keyDown(searchbox, { key: "Enter" });
    expect(screen.getByRole("status", { name: "Occurrences" }).textContent).toBe("2 / 2");
    expect(articles[0].classList.contains("conversation-search-current")).toBe(false);
    expect(articles[1].classList.contains("conversation-search-current")).toBe(true);

    // Échap ferme la barre et efface la recherche.
    fireEvent.keyDown(searchbox, { key: "Escape" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(document.querySelectorAll("mark.conversation-search-hit")).toHaveLength(0);
  });

  it("searches tool call results and subagent names", async () => {
    const withTool = {
      ...detail,
      snapshot: {
        ...detail.snapshot,
        items: [
          ...detail.snapshot.items,
          { externalItemId: "item-tool", externalTurnId: "turn-active", role: "tool", kind: "tool_result", order: 4, text: "exit code 0 · 12 files changed", name: "shell", sourceAt: null, receivedAt: "2026-01-01" }
        ]
      }
    };
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (init?.method === "POST") return json({ ref: detail.snapshot.session.ref, externalTurnId: "turn-new" });
      if (path.endsWith("/capabilities")) return json(control);
      if (path.endsWith("/provider-session")) return json(withTool);
      return json(mission);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderMissionConversationPage missionId={mission.id} />);
    await screen.findByText("Provider mission");

    fireEvent.click(screen.getByRole("button", { name: /Rechercher/ }));
    const searchbox = screen.getByRole("searchbox");
    fireEvent.change(searchbox, { target: { value: "files changed" } });
    expect((await screen.findByRole("status", { name: "Occurrences" })).textContent).toBe("1 / 1");
    const toolText = document.querySelector(".provider-thread-tool-text");
    expect(toolText?.querySelectorAll("mark.conversation-search-hit")).toHaveLength(1);
    expect(toolText?.querySelector("mark")?.textContent).toBe("files changed");

    // Le nom du sous-agent est aussi un champ recherchable (surligné dans le <code>).
    fireEvent.change(searchbox, { target: { value: "codex" } });
    expect((await screen.findByRole("status", { name: "Occurrences" })).textContent).toBe("1 / 1");
    const code = Array.from(document.querySelectorAll("article.provider-thread-item > code"))
      .find((node) => node.querySelector("mark.conversation-search-hit"));
    expect(code?.querySelector("mark")?.textContent).toBe("codex");
  });

  it("reports no result when the query matches nothing", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: /Rechercher/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "introuvable" } });
    expect((await screen.findByRole("status", { name: "Occurrences" })).textContent).toBe("Aucun résultat");
    expect(document.querySelectorAll("mark.conversation-search-hit")).toHaveLength(0);
  });
});
