import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import type { AgentSessionView, MissionView, ProviderOptionsCatalog, ProviderReasoningEffort } from "../types";
import { loadAgentSession, startMissionSession, steerRun, forceStopRun } from "../services/agent-session-service";
import { loadAgentConversationCatalog, type AgentConversationCatalogEntry } from "../services/agent-conversation-catalog-service";
import { extractConversationStats, normalizeAgentConversation, type AgentConversationEvent, type ConversationStats } from "../services/agent-conversation-normalizer";
import { showMission } from "../services/mission-service";
import { getMissionUiPolicy, type MissionUiAction } from "../services/mission-ui-policy";
import { performMissionAction } from "../services/mission-action-service";
import { loadProviderOptions, reasoningLabels } from "../services/provider-service";
import { PixelAvatar } from "./PixelAvatar";

const SIDEBAR_OPEN_KEY = "nodra.agent.sidebar.open";

function providerLabel(providerId?: string) {
  if (!providerId) return "Provider";
  if (providerId === "github-copilot") return "Copilot";
  if (providerId === "opencode") return "OpenCode";
  if (providerId === "codex") return "Codex";
  return providerId;
}

function statusLabel(status?: string) {
  return ({ QUEUED: "en file", STARTING: "démarrage", RUNNING: "en cours", WAITING_APPROVAL: "validation", SUCCEEDED: "terminé", FAILED: "échec", CANCELLED: "annulé", UNKNOWN: "inconnu" } as Record<string, string>)[status ?? ""] ?? status ?? "—";
}

function money(value?: number) {
  if (value == null) return "—";
  return value > 0 && value < 0.001 ? "< 0,001 $" : `${value.toLocaleString("fr-FR", { minimumFractionDigits: value < 0.1 ? 3 : 2, maximumFractionDigits: value < 0.1 ? 4 : 2 })} $`;
}

async function copy(text: string, onDone: (message: string) => void) {
  await navigator.clipboard.writeText(text);
  onDone("Copié");
}

function Bubble({ kind, author, text }: { kind: "user" | "assistant" | "error"; author: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copyMessage = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className={`event ${kind}`}>
      <div className="bubble">
        <div className="bubble-head"><div className="author">{author}</div><button type="button" className={`message-copy-button${copied ? " copied" : ""}`} onClick={() => void copyMessage()}>{copied ? "✓ Copié" : "Copier"}</button></div>
        <div className="message-text markdown">{text}</div>
      </div>
    </div>
  );
}

function ThinkingBubble({ providerId }: { providerId?: string }) {
  return (
    <div className="event assistant thinking">
      <div className="bubble">
        <div className="bubble-head"><div className="author">{providerLabel(providerId)}</div></div>
        <div className="thinking-line"><span className="thinking-label">L'agent réfléchit</span><span className="thinking-dots"><i /><i /><i /></span></div>
      </div>
    </div>
  );
}

function ToolEvent({ event }: { event: Extract<AgentConversationEvent, { kind: "tool" }> }) {
  return (
    <div className="event tool">
      <div className="bubble">
        <div className="author">{event.title}</div>
        {event.command && <pre className="command">{event.command}</pre>}
        {event.output && <details className="tool-details" open={!event.command}><summary>Afficher la sortie</summary><pre className="command">{event.output}</pre></details>}
      </div>
    </div>
  );
}

function EventView({ event }: { event: AgentConversationEvent }) {
  if (event.kind === "system") return <div className="system-event">{event.text}</div>;
  if (event.kind === "tool") return <ToolEvent event={event} />;
  if (event.kind === "reasoning") return <ToolEvent event={{ kind: "tool", id: event.id, title: "Réflexion", output: event.text, at: event.at }} />;
  if (event.kind === "error") return <Bubble kind="error" author="Erreur" text={event.text} />;
  return <Bubble kind={event.kind} author={event.kind === "user" ? "Vous" : providerLabel(event.providerId)} text={event.text} />;
}

function UsageCard({ label, value, percent }: { label: string; value: string; percent?: number }) {
  return <div><span>{label}</span><strong>{value}</strong><i><b style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }} /></i></div>;
}

function ConversationHeader({ mission, session, stats, onToast }: { mission: MissionView | null; session: AgentSessionView | null; stats: ConversationStats; onToast(message: string): void }) {
  const contextValue = stats.contextLeftPercent == null ? "—" : `${stats.contextLeftPercent}%`;
  const tokens = stats.totalTokens == null ? "—" : stats.totalTokens.toLocaleString("fr-FR");
  return (
    <header className="conversation-header">
      <div className="conversation-title">
        <span className={`status-orb ${session?.run.state.toLowerCase() ?? "idle"}`} />
        <div><h1 title={mission?.title ?? "Conversation agent"}>{mission?.title ?? "Conversation agent"}</h1><p>{providerLabel(stats.providerId)} · {stats.modelId ?? session?.run.modelId ?? "model"} · {statusLabel(session?.run.state)}</p></div>
      </div>
      <div className="conversation-usage" aria-label="Statistiques agent">
        <UsageCard label="Contexte restant" value={contextValue} percent={stats.contextLeftPercent} />
        <UsageCard label="Tokens" value={tokens} percent={stats.totalTokens ? Math.min(100, stats.totalTokens / 2000) : 0} />
        <UsageCard label="Coût" value={money(stats.costUsd)} percent={stats.costUsd ? Math.min(100, stats.costUsd * 100) : 0} />
      </div>
      <div className="conversation-actions">
        <button className="ghost-button" disabled={!session} onClick={() => session && void copy(session.run.id, onToast)}>Copier run</button>
        <button className="ghost-button" disabled={!stats.providerSessionRef} onClick={() => stats.providerSessionRef && void copy(stats.providerSessionRef, onToast)}>Copier provider</button>
        <a className="ghost-button" href="/">← Mes tâches</a>
      </div>
    </header>
  );
}

function ConversationSidebar({ catalog, activeThreadId, search, onSearch }: { catalog: AgentConversationCatalogEntry[]; activeThreadId: string; search: string; onSearch(value: string): void }) {
  const filtered = catalog.filter((entry) => `${entry.missionTitle} ${entry.providerId} ${entry.missionState} ${entry.runState}`.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <aside className="conversation-sidebar" aria-label="Conversations">
      <header><div><span>CONVERSATIONS</span><br></br> <strong>Agents accessibles</strong></div></header>
      <label className="conversation-search"><span>⌕</span><input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Chercher un chat…" aria-label="Rechercher une conversation" /></label>
      <div className="conversation-sidebar-scroll">
        <section><header><span>MISSIONS</span><b>{filtered.length}</b></header>{filtered.map((entry) => (
          <div className={`conversation-sidebar-row${entry.threadId === activeThreadId ? " active" : ""}`} key={entry.threadId}>
            <button type="button" className="conversation-open-button" onClick={() => { if (entry.threadId !== activeThreadId) location.assign(`/agent.html?threadId=${encodeURIComponent(entry.threadId)}`); }}>
              <span className="conversation-avatar"><PixelAvatar id={entry.missionId} title={entry.missionTitle} mini /><i className={`tab-status ${entry.runState.toLowerCase()}`} /></span>
              <span><strong>{entry.missionTitle}</strong><small>{providerLabel(entry.providerId)} · {entry.modelId} · {entry.missionState}</small></span>
            </button>
          </div>
        ))}</section>
      </div>
      <footer><span><i /> {filtered.length ? `${filtered.length} conversation${filtered.length > 1 ? "s" : ""}` : "Aucun run accessible"}</span></footer>
    </aside>
  );
}

function ConversationComposer({ session, providerOptions, prompt, modelId, reasoningEffort, canSend, onPromptChange, onModelChange, onReasoningChange, onSubmit, onSteer }: { session: AgentSessionView | null; providerOptions: ProviderOptionsCatalog | null; prompt: string; modelId: string; reasoningEffort: ProviderReasoningEffort; canSend: boolean; onPromptChange(value: string): void; onModelChange(value: string): void; onReasoningChange(value: ProviderReasoningEffort): void; onSubmit(event: FormEvent): void; onSteer(): void }) {
  const provider = providerOptions?.providers.find((item) => item.id === session?.run.providerId);
  const selectedModel = provider?.models.find((item) => item.id === modelId);
  const reasoningOptions = selectedModel?.supportedReasoningEfforts.length ? selectedModel.supportedReasoningEfforts : providerOptions?.reasoningEfforts ?? [];
  const running = session?.run.state === "RUNNING" || session?.run.state === "STARTING" || session?.run.state === "QUEUED";
  const sendLabel = running ? "Ajouter à la queue" : "Envoyer";
  return (
    <footer className="composer-wrap">
      <form className="agent-composer" onSubmit={onSubmit}>
        <textarea rows={2} maxLength={20000} placeholder={`Donne une nouvelle instruction à ${providerLabel(session?.run.providerId)}…`} value={prompt} onChange={(event) => onPromptChange(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        <div className="composer-bottom">
          <div className="composer-options">
            <label>Modèle<select value={modelId} onChange={(event) => onModelChange(event.target.value)}>{provider?.models.length ? provider.models.map((model) => <option value={model.id} key={model.id}>{model.label}</option>) : <option value={modelId}>{modelId}</option>}</select></label>
            <label>Réflexion<select value={reasoningEffort} onChange={(event) => onReasoningChange(event.target.value as ProviderReasoningEffort)}>{reasoningOptions.map((effort) => <option value={effort} key={effort}>{reasoningLabels[effort] ?? effort}</option>)}</select></label>
            <span className="thread-label">{session?.run.id ?? "run"}</span>
          </div>
          <div className="composer-actions">{running && <button type="button" className="steer-button" disabled={!canSend} onClick={onSteer}>↳ Steer</button>}<button type="submit" className="send-button" disabled={!session || !prompt.trim() || !canSend}>{sendLabel} <span>⌘↵</span></button></div>
        </div>
      </form>
      <p className="permission-note">{running ? "Le message est envoyé au thread actif du provider." : "Après un run terminé, Envoyer crée un nouveau tour de mission avec ton message."}</p>
    </footer>
  );
}

export function AgentPage() {
  const threadId = new URLSearchParams(location.search).get("threadId") ?? "";
  const [session, setSession] = useState<AgentSessionView | null>(null);
  const [mission, setMission] = useState<MissionView | null>(null);
  const [catalog, setCatalog] = useState<AgentConversationCatalogEntry[]>([]);
  const [providerOptions, setProviderOptions] = useState<ProviderOptionsCatalog | null>(null);
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState("default");
  const [reasoningEffort, setReasoningEffort] = useState<ProviderReasoningEffort>("provider_default");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [connected, setConnected] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem(SIDEBAR_OPEN_KEY) !== "false");
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [pending, setPending] = useState<{ text: string; baselineAgentEvents: number } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const autoScrollRef = useRef(true);
  const dispatchedRunRef = useRef<string | null>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const events = useMemo(() => normalizeAgentConversation(session), [session]);
  const agentEventCount = useMemo(() => events.filter((event) => event.kind === "assistant" || event.kind === "tool" || event.kind === "reasoning" || event.kind === "error").length, [events]);
  const stats = useMemo(() => extractConversationStats(session), [session]);
  const running = session?.run.state === "RUNNING" || session?.run.state === "STARTING" || session?.run.state === "QUEUED";
  const canStartFollowUp = Boolean(mission && ["DRAFT", "READY", "VALIDATION"].includes(mission.state));
  const canSend = Boolean(session && (running || canStartFollowUp));
  const missionPolicy = useMemo(() => mission ? getMissionUiPolicy({
    mission,
    hasAgentConfig: true,
    latestRunId: session?.run.id ?? null,
    latestRunState: session?.run.state ?? null,
    hasDelivery: false,
    hasResultText: agentEventCount > 0
  }) : null, [mission, session?.run.id, session?.run.state, agentEventCount]);
  const chatActions = (missionPolicy?.actions ?? []).filter((item) => ["validate", "abandon", "resume", "accept-result", "request-changes"].includes(item.id));

  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 1800); };
  const toggleSidebar = () => setSidebarOpen((current) => { const next = !current; localStorage.setItem(SIDEBAR_OPEN_KEY, String(next)); return next; });

  useEffect(() => { void loadProviderOptions().then(setProviderOptions).catch(() => undefined); }, []);
  useEffect(() => { void loadAgentConversationCatalog().then(setCatalog).catch(() => undefined); }, []);

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    const load = () => void loadAgentSession(threadId)
      .then((result) => {
        if (cancelled) return;
        setSession(result);
        setModelId(result.run.modelId);
        setReasoningEffort((result.run.reasoningEffort as ProviderReasoningEffort | null) ?? "provider_default");
        setConnected(true);
        if (result.run.missionId) void showMission(result.run.missionId).then((next) => { if (!cancelled) setMission(next); }).catch(() => undefined);
      })
      .catch((reason: Error) => { if (!cancelled) { setConnected(false); setError(reason.message); } });
    load();
    const timer = window.setInterval(load, 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [threadId]);

  useEffect(() => {
    const container = conversationRef.current;
    if (container && autoScrollRef.current) container.scrollTop = container.scrollHeight;
  }, [events.length, pending, running]);
  useEffect(() => { autoScrollRef.current = true; setAutoScroll(true); }, [threadId]);
  useEffect(() => { setPending(null); }, [threadId]);
  useEffect(() => {
    if (session?.run.state !== "QUEUED") return;
    const runId = session.run.id;
    if (dispatchedRunRef.current === runId) return;
    dispatchedRunRef.current = runId;
    void api("/api/runtime/temporal/dispatch", { method: "POST", body: JSON.stringify({ limit: 20 }) }).catch(() => undefined);
  }, [session?.run.state, session?.run.id]);
  useEffect(() => {
    if (!pending) return;
    const terminal = session ? ["SUCCEEDED", "FAILED", "CANCELLED"].includes(session.run.state) : false;
    if (agentEventCount > pending.baselineAgentEvents || terminal) setPending(null);
  }, [agentEventCount, pending, session]);
  const stopAutoScroll = () => { autoScrollRef.current = false; setAutoScroll(false); };
  const resumeAutoScroll = () => { autoScrollRef.current = true; setAutoScroll(true); const container = conversationRef.current; if (container) container.scrollTop = container.scrollHeight; };
  const handleConversationScroll = () => { const container = conversationRef.current; if (container && autoScrollRef.current && container.scrollHeight - container.scrollTop - container.clientHeight > 24) stopAutoScroll(); };

  const send = async (_mode: "queue" | "steer") => {
    if (!session || !prompt.trim()) return;
    const value = prompt.trim();
    setPrompt("");
    setError("");
    setPending({ text: value, baselineAgentEvents: agentEventCount });
    try {
      if (running) {
        await steerRun(session.run.id, value);
        setSession(await loadAgentSession(threadId || session.run.id));
        flash("Instruction envoyée au run actif");
      } else if (mission) {
        await startMissionSession(mission.id, mission.version, value);
        setSession(await loadAgentSession(threadId || session.run.id));
        flash("Nouveau tour de mission lancé");
      } else {
        throw new Error("Mission introuvable pour créer un nouveau tour.");
      }
    } catch (reason) {
      setError((reason as Error).message);
      setPrompt(value);
      setPending(null);
    }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void send("queue"); };
  const forceStop = async () => {
    if (!session) return;
    if (!window.confirm("Forcer l'arrêt de l'agent ?\n\nLa session provider est coupée, le run passe en annulé et la mission repasse sous ton contrôle.")) return;
    setBusyAction("force-stop");
    setError("");
    setPending(null);
    try {
      await forceStopRun(session.run.id);
      if (threadId) setSession(await loadAgentSession(threadId));
      if (mission) await showMission(mission.id).then(setMission).catch(() => undefined);
      flash("Agent arrêté · mission reprise en main");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusyAction(null);
    }
  };
  const runMissionAction = async (action: MissionUiAction) => {
    if (!mission) return;
    if (!action.enabled) { setError(action.disabledReason ?? "Action indisponible pour cet état."); return; }
    setBusyAction(action.id);
    setError("");
    try {
      await performMissionAction({ actionId: action.id, mission, latestRunId: session?.run.id ?? null });
      const nextMission = await showMission(mission.id);
      setMission(nextMission);
      if (threadId) setSession(await loadAgentSession(threadId));
      flash(`${action.label} · appliqué`);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="agent-app">
      <header className="agent-topbar">
        <button type="button" className={`conversation-sidebar-toggle${sidebarOpen ? " active" : ""}`} onClick={toggleSidebar} aria-label={sidebarOpen ? "Fermer les conversations" : "Ouvrir les conversations"}><span /><span /><span /></button>
        <a className="agent-brand" href="/"><span className="agent-logo">N</span><span><strong>Nodra</strong><small>Conversation desk</small></span></a>
        <div className="topbar-board-state"><i>1</i><span>flux visible</span></div>
        <div className="connection-state"><span className={`live-dot ${connected ? "connected" : "error"}`} /><span>{connected ? "En direct" : "Reconnexion…"}</span></div>
        <div className="danger-chip">FULL ACCESS</div>
      </header>
      <div className={`conversation-workbench stream-count-1${sidebarOpen ? " sidebar-open" : ""}`}>
        {sidebarOpen && <ConversationSidebar catalog={catalog} activeThreadId={threadId} search={sidebarSearch} onSearch={setSidebarSearch} />}
        <main className="agent-main">
          <div className="conversation-board">
            <section className="conversation-shell">
              <ConversationHeader mission={mission} session={session} stats={stats} onToast={flash} />
              {error && <p className="inspector-error">{error}</p>}
              {(chatActions.length > 0 || running) && (
                <div className="mission-action-bar" aria-label="Actions mission">
                  <span className="mission-action-state">{missionPolicy?.phaseLabel ?? statusLabel(session?.run.state)}</span>
                  {running && (
                    <button
                      type="button"
                      className="mission-action-button force-stop"
                      disabled={busyAction !== null}
                      onClick={() => void forceStop()}
                    >
                      {busyAction === "force-stop" ? "Arrêt…" : "⏹ Forcer l'arrêt"}
                    </button>
                  )}
                  {chatActions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className={`mission-action-button${action.primary ? " primary" : ""}${action.danger ? " danger" : ""}`}
                      disabled={busyAction !== null || !action.enabled}
                      title={action.enabled ? undefined : action.disabledReason}
                      onClick={() => void runMissionAction(action)}
                    >
                      {busyAction === action.id ? "Patiente…" : action.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="conversation-feed-wrap">
                <div className="agent-conversation" ref={conversationRef} aria-live="polite" onScroll={handleConversationScroll} onWheel={stopAutoScroll} onTouchMove={stopAutoScroll}>
                  {!events.length && !pending && !running ? <div className="conversation-empty">En attente du premier événement…</div> : events.map((event) => <EventView event={event} key={event.id} />)}
                  {pending && !events.some((event) => event.kind === "user" && event.text.trim() === pending.text) && <Bubble kind="user" author="Vous" text={pending.text} />}
                  {(pending || running) && <ThinkingBubble providerId={session?.run.providerId} />}
                </div>
                {!autoScroll && <button type="button" className="resume-auto-scroll" onClick={resumeAutoScroll}>↓ Reprendre le suivi</button>}
              </div>
              <ConversationComposer session={session} providerOptions={providerOptions} prompt={prompt} modelId={modelId} reasoningEffort={reasoningEffort} canSend={canSend} onPromptChange={setPrompt} onModelChange={setModelId} onReasoningChange={setReasoningEffort} onSubmit={submit} onSteer={() => void send("steer")} />
            </section>
          </div>
        </main>
      </div>
      <div className={`toast ${toast ? "visible" : ""}`} role="status">{toast}</div>
    </div>
  );
}
