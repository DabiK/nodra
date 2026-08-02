import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MissionProviderSessionCapabilitiesView, MissionView, ProviderOptionsCatalog, ProviderReasoningEffort, ProviderSessionDetailView } from "../types";
import {
  activateMissionProviderSession,
  ensureMissionObservationSession,
  loadMissionProviderSession,
  loadMissionProviderSessionCapabilities,
  startMissionProviderTurn,
  steerMissionProviderTurn
} from "../services/mission-provider-session-service";
import { loadProviderOptions, reasoningLabels } from "../services/provider-service";
import { showMission } from "../services/mission-service";
import { latestRunForMission } from "../services/mission-result-service";
import { loadAgentSession } from "../services/agent-session-service";
import { extractRunFailure, type RunFailure } from "../services/agent-conversation-normalizer";
import { assessConversationContext } from "../services/conversation-context-service";
import { providerSessionSections } from "../services/provider-session-sections";
import { subagentStatusLabel, subagentToolLabel } from "../services/subagent-labels";
import { SubagentExecution } from "./SubagentExecution";
import { ModelPicker } from "./ModelPicker";
import { PromptEnhanceDialog } from "./PromptEnhanceDialog";
import { ConversationContextBanner } from "./ConversationContextBanner";
import { ConversationSearchBar } from "./ConversationSearchBar";
import { HighlightedText } from "./HighlightedText";
import { useConversationSearch } from "../hooks/useConversationSearch";
import { useSseRefresh } from "../hooks/useSseRefresh";
import { suppressServerEventsFor } from "../services/events-service";

/** Fenêtre de silence SSE après une mutation locale (évite l'écho en boucle). */
const SSE_SUPPRESSION_MS = 2500;

/**
 * Instruction de compaction envoyée au provider quand la conversation devient
 * longue (issue #10) : un résumé structuré sert de point de reprise avant
 * saturation du contexte. "Compact/truncate" côté provider = steer avec
 * instruction de résumé, comme suggéré par l'issue.
 */
const COMPACT_INSTRUCTION = `Compaction du contexte nécessaire : la conversation est devenue longue et risque de perdre du contexte.
Réponds uniquement avec un résumé structuré et concis, sans exécuter d'autre action :
1. Objectif de la mission et état actuel.
2. Décisions, résultats et fichiers touchés jusqu'ici.
3. Prochaines étapes restantes.
Ce résumé servira de point de reprise dans la suite de la conversation.`;

function capabilityAvailable(state: string | undefined) {
  return Boolean(state && state !== "unavailable");
}

function isActiveTurn(state: string) {
  return ["active", "running", "in_progress", "started"].includes(state.toLowerCase());
}

function commandId() {
  return crypto.randomUUID();
}

function providerLabel(providerId: string) {
  if (providerId === "github-copilot") return "Copilot";
  if (providerId === "opencode") return "OpenCode";
  return providerId ? providerId.charAt(0).toUpperCase() + providerId.slice(1) : "Provider";
}

function runPrefsKey(missionId: string) {
  return `nodra:thread-run:${missionId}`;
}

interface ThreadRunPrefs {
  modelId: string | null;
  reasoningEffort: ProviderReasoningEffort | null;
}

function loadRunPrefs(missionId: string): ThreadRunPrefs {
  try {
    const raw = localStorage.getItem(runPrefsKey(missionId));
    if (!raw) return { modelId: null, reasoningEffort: null };
    const parsed = JSON.parse(raw) as Partial<ThreadRunPrefs>;
    return {
      modelId: typeof parsed.modelId === "string" ? parsed.modelId : null,
      reasoningEffort: typeof parsed.reasoningEffort === "string"
        ? parsed.reasoningEffort as ProviderReasoningEffort
        : null
    };
  } catch {
    return { modelId: null, reasoningEffort: null };
  }
}

function saveRunPrefs(missionId: string, prefs: ThreadRunPrefs) {
  try {
    localStorage.setItem(runPrefsKey(missionId), JSON.stringify(prefs));
  } catch {
    // Le stockage local peut être indisponible ; la préférence reste de session.
  }
}

function modelsForProvider(catalog: ProviderOptionsCatalog, providerId: string) {
  return catalog.providers.find((provider) => provider.id === providerId)?.models.filter((model) => !model.hidden) ?? [];
}

function reasoningEffortOptions(catalog: ProviderOptionsCatalog, modelId: string | null): ProviderReasoningEffort[] {
  const model = catalog.providers
    .flatMap((provider) => provider.models)
    .find((candidate) => candidate.id === modelId);
  return model && model.supportedReasoningEfforts.length > 0
    ? model.supportedReasoningEfforts
    : catalog.reasoningEfforts;
}

function itemLabel(item: ProviderSessionDetailView["snapshot"]["items"][number], providerId: string) {
  if (item.role === "user") return "Vous";
  if (item.kind === "subagent") return "Sous-agent";
  if (item.role === "assistant" && item.kind === "message") return providerLabel(providerId);
  if (item.role === "assistant") return `${providerLabel(providerId)} · activité`;
  if (item.role === "tool") return "Outil";
  return item.role || "Activité";
}

function ProviderItem({ item, providerId, query, isSearchHit, isCurrentMatch }: { item: ProviderSessionDetailView["snapshot"]["items"][number]; providerId: string; query: string; isSearchHit: boolean; isCurrentMatch: boolean }) {
  const message = item.kind === "message";
  const user = item.role === "user";
  const subagent = item.kind === "subagent";
  const tool = !message && !subagent && (item.kind === "tool_call" || item.kind === "tool_result");
  const statusLabel = subagent ? subagentStatusLabel(item.text) : null;
  const searching = query.trim() !== "";
  const body = message ? (
    <div className="provider-thread-markdown">
      {searching && isSearchHit
        ? <p className="provider-thread-search-text"><HighlightedText text={item.text ?? "—"} query={query} /></p>
        : <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{item.text ?? "—"}</ReactMarkdown>}
    </div>
  ) : statusLabel ? (
    <span className="subagent-chip">{statusLabel}</span>
  ) : (
    <p className={tool ? "provider-thread-tool-text" : undefined}>
      {searching && isSearchHit ? <HighlightedText text={item.text ?? "—"} query={query} /> : item.text ?? "—"}
    </p>
  );
  return (
    <article className={`provider-thread-item ${user ? "user" : message ? "assistant" : subagent ? "subagent" : "tool"}${isCurrentMatch ? " conversation-search-current" : ""}`} data-external-item-id={item.externalItemId}>
      <header><strong>{itemLabel(item, providerId)}</strong><span>{item.kind} · {item.externalItemId}</span></header>
      {item.name ? <code>{searching && isSearchHit ? <HighlightedText text={subagentToolLabel(item.name) ?? item.name} query={query} /> : subagentToolLabel(item.name) ?? item.name}</code> : null}
      {body}
      {subagent && item.subagent ? <SubagentExecution execution={item.subagent} /> : null}
    </article>
  );
}

function ProviderFeed({ detail, busy, thinking, sentText, searchQuery, searchHitIds, activeMatchId }: {
  detail: ProviderSessionDetailView | null;
  busy: boolean;
  thinking: boolean;
  sentText: string | null;
  searchQuery: string;
  searchHitIds: Set<string>;
  activeMatchId: string | null;
}) {
  if (!detail) return <div className="conversation-empty">Connexion au fil provider…</div>;
  const { turns, items } = detail.snapshot;
  const providerId = detail.identity.providerId;
  const sections = providerSessionSections(turns, items);
  return <>
    {sections.map((section) => section.turn ? (
      <section className="provider-thread-turn" data-external-turn-id={section.turn.externalTurnId} key={section.turn.externalTurnId}>
        <header><strong>Tour {section.turn.order}</strong><span className={isActiveTurn(section.turn.state) ? "active" : ""}>{section.turn.state}</span><code>{section.turn.externalTurnId}</code></header>
        <div>{section.items.map((item) => <ProviderItem item={item} providerId={providerId} query={searchQuery} isSearchHit={searchHitIds.has(item.externalItemId)} isCurrentMatch={activeMatchId === item.externalItemId} key={item.externalItemId} />)}</div>
      </section>
    ) : (
      <section className="provider-thread-turn" key={section.items[0]?.externalItemId}>
        <div>{section.items.map((item) => <ProviderItem item={item} providerId={providerId} query={searchQuery} isSearchHit={searchHitIds.has(item.externalItemId)} isCurrentMatch={activeMatchId === item.externalItemId} key={item.externalItemId} />)}</div>
      </section>
    ))}
    {!turns.length && !items.length ? <div className="conversation-empty">La conversation ne contient encore aucun élément.</div> : null}
    {busy ? <div className="provider-thread-sync" role="status">Synchronisation avec le provider…</div> : null}
    {sentText ? (
      <article className="provider-thread-item user provider-thread-pending" role="status" aria-label="Message envoyé">
        <header><strong>Vous</strong><span className="provider-thread-pending-label"><span className="thinking-dots"><i /><i /><i /></span> envoi en cours…</span></header>
        <div className="provider-thread-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{sentText}</ReactMarkdown></div>
      </article>
    ) : null}
    {thinking ? <article className="provider-thread-item assistant provider-thread-thinking" role="status" aria-label={`${providerLabel(providerId)} réfléchit…`}><span className="thinking-dots"><i /><i /><i /></span><strong>{providerLabel(providerId)} réfléchit…</strong></article> : null}
  </>;
}

export function ProviderMissionConversationPage({ missionId }: { missionId: string }) {
  const [mission, setMission] = useState<MissionView | null>(null);
  const [detail, setDetail] = useState<ProviderSessionDetailView | null>(null);
  const [control, setControl] = useState<MissionProviderSessionCapabilitiesView | null>(null);
  const [catalog, setCatalog] = useState<ProviderOptionsCatalog | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"send" | "steer" | null>(null);
  const [sentText, setSentText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [failure, setFailure] = useState<RunFailure | null>(null);
  const [connected, setConnected] = useState(false);
  const [runModelId, setRunModelId] = useState<string | null>(null);
  const [runReasoningEffort, setRunReasoningEffort] = useState<ProviderReasoningEffort>("provider_default");
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const activationRef = useRef(false);
  const ensureRef = useRef(false);
  const catalogRef = useRef(false);
  const commandRef = useRef<{ kind: "send" | "steer"; text: string; id: string } | null>(null);

  useEffect(() => {
    if (catalogRef.current) return;
    catalogRef.current = true;
    void loadProviderOptions()
      .then((options) => { if (Array.isArray(options.providers)) setCatalog(options); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!detail || !catalog) return;
    const prefs = loadRunPrefs(missionId);
    const models = modelsForProvider(catalog, detail.identity.providerId);
    const modelId = prefs.modelId && models.some((model) => model.id === prefs.modelId)
      ? prefs.modelId
      : (models[0]?.id ?? null);
    const selected = models.find((model) => model.id === modelId) ?? null;
    const efforts = selected && selected.supportedReasoningEfforts.length > 0
      ? selected.supportedReasoningEfforts
      : catalog.reasoningEfforts;
    const effort = prefs.reasoningEffort && efforts.includes(prefs.reasoningEffort)
      ? prefs.reasoningEffort
      : "provider_default";
    setRunModelId(modelId);
    setRunReasoningEffort(effort);
  }, [detail, catalog, missionId]);

  const persistRunPrefs = (modelId: string | null, effort: ProviderReasoningEffort) => {
    setRunModelId(modelId);
    setRunReasoningEffort(effort);
    saveRunPrefs(missionId, { modelId, reasoningEffort: effort });
  };

  const refresh = useCallback(async () => {
    try {
      let nextMission = await showMission(missionId);
      if (nextMission.state === "READY" && !activationRef.current) {
        activationRef.current = true;
        try {
          suppressServerEventsFor(SSE_SUPPRESSION_MS);
          await activateMissionProviderSession(missionId, nextMission.version, commandId());
          nextMission = await showMission(missionId);
        } catch {
          // Best-effort: sans lien provider à activer, on retombe sur le chemin
          // load + ensure-observation ci-dessous (ou l'état "en attente").
        }
      }
      let nextDetail: ProviderSessionDetailView | null = null;
      try {
        nextDetail = await loadMissionProviderSession(missionId);
      } catch (reason) {
        const message = (reason as Error).message;
        if (message.includes("has no active provider session")) {
          // Tentative unique par chargement : le POST publie un data_changed
          // sur le SSE ; le répéter à chaque événement créerait une boucle
          // infinie (POST → event → refresh → POST…).
          if (ensureRef.current) {
            setMission(nextMission);
            setDetail(null);
            setControl(null);
            setFailure(null);
            setConnected(false);
            setError("");
            setPending(nextMission.state === "READY" || nextMission.state === "DRAFT"
              ? "Lance d'abord la mission depuis la liste pour démarrer le thread provider."
              : "En attente du démarrage du thread provider…");
            return;
          }
          ensureRef.current = true;
          try {
            suppressServerEventsFor(SSE_SUPPRESSION_MS);
            await ensureMissionObservationSession(missionId, commandId());
            nextDetail = await loadMissionProviderSession(missionId);
          } catch {
            setMission(nextMission);
            setDetail(null);
            setControl(null);
            setFailure(null);
            setConnected(false);
            setError("");
            setPending(nextMission.state === "READY" || nextMission.state === "DRAFT"
              ? "Lance d'abord la mission depuis la liste pour démarrer le thread provider."
              : "En attente du démarrage du thread provider…");
            return;
          }
        } else {
          throw reason;
        }
      }
      const [nextControl] = await Promise.all([
        loadMissionProviderSessionCapabilities(missionId)
      ]);
      let nextFailure: RunFailure | null = null;
      if (nextMission.state === "BLOCKED") {
        try {
          const latest = await latestRunForMission(missionId);
          if (latest) nextFailure = extractRunFailure(await loadAgentSession(latest.runId));
        } catch {
          nextFailure = null;
        }
      }
      setMission(nextMission);
      setDetail(nextDetail);
      setControl(nextControl);
      setFailure(nextFailure);
      setConnected(true);
      setError("");
      setPending("");
    } catch (reason) {
      activationRef.current = false;
      setConnected(false);
      setError((reason as Error).message);
    }
  }, [missionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Temps réel : le flux SSE remplace le polling toutes les 1,5 s.
  useSseRefresh(() => void refresh());

  // Recherche dans le fil : texte des messages, sorties de tool calls et noms
  // de sous-agents sont indexés côté client (issue #9).
  const searchMessages = useMemo(() => (detail?.snapshot.items ?? []).map((item) => ({
    id: item.externalItemId,
    fields: item.kind === "subagent" ? [item.name] : [item.text]
  })), [detail]);
  const search = useConversationSearch(searchMessages);
  const searchHitIds = useMemo(() => new Set(search.matches.map((match) => match.messageId)), [search.matches]);
  const searching = search.query.trim() !== "";
  const toggleSearch = () => {
    setSearchOpen((open) => {
      if (open) search.clear();
      return !open;
    });
  };
  const closeSearch = () => {
    setSearchOpen(false);
    search.clear();
  };

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || searching) return; // en recherche, le défilement suit les occurrences
    feed.scrollTop = feed.scrollHeight;
  }, [detail?.snapshot.cursor, detail?.snapshot.items.length, detail?.snapshot.turns.length, searching]);

  // Défilement vers l'occurrence active de la recherche.
  useEffect(() => {
    if (!search.activeMatch) return;
    const feed = feedRef.current;
    const target = Array.from(feed?.querySelectorAll("[data-external-item-id]") ?? [])
      .find((element) => element.getAttribute("data-external-item-id") === search.activeMatch?.messageId);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [search.activeMatch]);

  const activeTurn = useMemo(() => [...(detail?.snapshot.turns ?? [])].reverse().find((turn) => isActiveTurn(turn.state)) ?? null, [detail]);
  const canControl = detail?.link?.mode === "control";
  const canStartTurn = Boolean(detail?.link && capabilityAvailable(control?.capabilities.startTurn.state));
  const canSteer = Boolean(detail?.link && detail?.snapshot.session.state === "active" && activeTurn && capabilityAvailable(control?.capabilities.steer.state));

  // Risque de perte de contexte (issue #10) : le snapshot provider ne porte
  // pas d'usage — tokens estimés depuis le texte des items, tours du snapshot.
  const contextRisk = useMemo(() => {
    if (!detail) return null;
    const items = detail.snapshot.items;
    const charCount = items.reduce((sum, item) => sum + (item.text?.length ?? 0) + (item.name?.length ?? 0), 0);
    return assessConversationContext({ turnCount: detail.snapshot.turns.length, charCount, totalTokens: null });
  }, [detail]);

  // Action de remédiation : steer du tour actif (ou nouveau tour) avec
  // l'instruction de résumé — même mécanique que l'envoi, sans toucher au
  // contenu du composer.
  const compactContext = async () => {
    if (busy) return;
    const steers = Boolean(canSteer && activeTurn);
    const sends = !steers && canStartTurn;
    if (!steers && !sends) return;
    const id = commandId();
    const run = {
      ...(runModelId ? { modelId: runModelId } : {}),
      ...(runReasoningEffort !== "provider_default" ? { reasoningEffort: runReasoningEffort } : {})
    };
    setBusy(steers ? "steer" : "send");
    setError("");
    setSentText(COMPACT_INSTRUCTION);
    try {
      if (steers) await steerMissionProviderTurn(missionId, activeTurn.externalTurnId, COMPACT_INSTRUCTION, id, run);
      else await startMissionProviderTurn(missionId, COMPACT_INSTRUCTION, id, run);
      await refresh();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(null);
      setSentText(null);
    }
  };

  const execute = async (kind: "send" | "steer") => {
    const value = text.trim();
    if (!value || busy || (kind === "send" ? !canStartTurn : !canSteer || !activeTurn)) return;
    const previous = commandRef.current;
    const id = previous?.kind === kind && previous.text === value ? previous.id : commandId();
    commandRef.current = { kind, text: value, id };
    setBusy(kind);
    setError("");
    setSentText(value);
    const run = {
      ...(runModelId ? { modelId: runModelId } : {}),
      ...(runReasoningEffort !== "provider_default" ? { reasoningEffort: runReasoningEffort } : {})
    };
    try {
      if (kind === "steer" && activeTurn) await steerMissionProviderTurn(missionId, activeTurn.externalTurnId, value, id, run);
      else await startMissionProviderTurn(missionId, value, id, run);
      commandRef.current = null;
      setText("");
      await refresh();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(null);
      setSentText(null);
    }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void execute("send"); };

  return (
    <div className="agent-app provider-thread-app">
      <header className="agent-topbar">
        <a className="agent-brand" href="/"><span className="agent-logo">N</span><span><strong>Nodra</strong><small>Provider thread</small></span></a>
        <div className="connection-state"><span className={`live-dot ${connected ? "connected" : "error"}`} /><span>{connected ? "En direct" : "Reconnexion…"}</span></div>
        <div className={`provider-thread-mode ${canControl ? "control" : canStartTurn ? "client" : "readonly"}`}>{canControl ? "CONTRÔLE ATTACHÉ" : canStartTurn ? "OBSERVATION + ENVOI" : "LECTURE SEULE"}</div>
      </header>
      <main className="provider-thread-main">
        <section className="conversation-shell">
          <header className="conversation-header provider-thread-header">
            <div className="conversation-title"><span className={`status-orb ${detail?.snapshot.session.state ?? "idle"}`} /><div><h1>{mission?.title ?? "Conversation provider"}</h1><p>{providerLabel(detail?.identity.providerId ?? "")} · {detail?.snapshot.session.state ?? "connexion"} · source externe</p></div></div>
            <div className="conversation-actions"><button type="button" className="ghost-button" onClick={() => void refresh()}>Rafraîchir</button><button type="button" className="ghost-button" aria-pressed={searchOpen} onClick={toggleSearch}>⌕ Rechercher</button><a className="ghost-button" href="/?page=provider-sessions">Sessions provider</a><a className="ghost-button" href="/">← Missions</a></div>
          </header>
          {error ? <p className="inspector-error" role="alert">{error}</p> : null}
          {pending ? <p className="inspector-note" role="status">{pending}</p> : null}
          {failure && (
            <div className="run-failure-banner" role="alert">
              <strong>⚠ {failure.title}</strong>
              <p>{failure.detail}</p>
            </div>
          )}
          <ConversationContextBanner
            risk={contextRisk}
            actionLabel={canStartTurn || canSteer ? "⟳ Compacter le contexte" : undefined}
            onAction={canStartTurn || canSteer ? () => void compactContext() : undefined}
            busy={busy !== null}
          />
          <div className="provider-thread-source"><span>Source de vérité provider</span><code>{detail?.identity.externalSessionRef ?? missionId}</code></div>
          {searchOpen ? (
            <ConversationSearchBar
              query={search.query}
              matchCount={search.matchCount}
              current={search.current}
              onQueryChange={search.setQuery}
              onNext={search.next}
              onPrev={search.prev}
              onClose={closeSearch}
            />
          ) : null}
          <div className="conversation-feed-wrap"><div className="agent-conversation provider-thread-feed" ref={feedRef} aria-live="polite"><ProviderFeed detail={detail} busy={busy !== null} thinking={activeTurn !== null} sentText={sentText} searchQuery={search.query} searchHitIds={searchHitIds} activeMatchId={search.activeMatch?.messageId ?? null} /></div></div>
          <footer className="composer-wrap">
            <form className="agent-composer" onSubmit={submit}>
              <textarea rows={2} maxLength={20000} value={text} onChange={(event) => setText(event.target.value)} placeholder="Écris une instruction au provider…" onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
              <div className="composer-bottom">
                <div className="composer-options">
                  {catalog && detail ? (
                    <div className="provider-thread-run" aria-label="Moteur, modèle et réflexion du prochain tour">
                      <span className="provider-thread-run-label">MOTEUR · MODÈLE · RÉFLEXION</span>
                      <div className="provider-thread-run-controls">
                        <label className="provider-thread-run-select" title="Le thread provider est lié à ce moteur ; le modèle et la réflexion sont libres.">
                          <span>{providerLabel(detail.identity.providerId)}</span>
                          <select value={detail.identity.providerId} aria-label="Provider lié à la session" disabled>
                            {catalog.providers.map((provider) => (
                              <option key={provider.id} value={provider.id}>{provider.label}</option>
                            ))}
                          </select>
                        </label>
                        <ModelPicker models={modelsForProvider(catalog, detail.identity.providerId)} value={runModelId ?? ""} onChange={(modelId) => persistRunPrefs(modelId, "provider_default")} idPrefix="provider-thread" />
                        <label className="provider-thread-run-select">
                          <span>Réflexion</span>
                          <select value={runReasoningEffort} onChange={(event) => persistRunPrefs(runModelId, event.target.value as ProviderReasoningEffort)} aria-label="Niveau de réflexion du prochain tour">
                            {reasoningEffortOptions(catalog, runModelId).map((effort) => (
                              <option key={effort} value={effort}>{reasoningLabels[effort] ?? effort}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  ) : null}
                  <span className="thread-label">{detail?.identity.externalSessionRef ?? "session provider"}</span>
                </div>
                <div className="composer-actions">
                  {catalog && text.trim() ? <button type="button" className="enhance-button" disabled={busy !== null} onClick={() => setEnhanceOpen(true)}>✦ Améliorer</button> : null}
                  {canSteer ? <button type="button" className="steer-button" disabled={!text.trim() || busy !== null} onClick={() => void execute("steer")}>{busy === "steer" ? "Steer…" : "↳ Steer le tour actif"}</button> : null}
                  <button type="submit" className="send-button" disabled={!text.trim() || !canStartTurn || busy !== null}>{busy === "send" ? "Envoi…" : "Envoyer un nouveau tour"} <span>⌘↵</span></button>
                </div>
              </div>
            </form>
            <p className="permission-note">Chaque envoi crée directement un tour chez le provider. Aucune file locale n’est utilisée. Le modèle et la réflexion choisis s’appliquent au prochain tour.</p>
          </footer>
          {catalog && enhanceOpen && detail ? (
            <PromptEnhanceDialog
              prompt={text}
              catalog={catalog}
              initialProviderId={detail.identity.providerId}
              initialModelId={runModelId ?? undefined}
              initialReasoningEffort={runReasoningEffort}
              onClose={() => setEnhanceOpen(false)}
              onEnhanced={(prompt) => { setText(prompt); setEnhanceOpen(false); }}
            />
          ) : null}
        </section>
      </main>
    </div>
  );
}
