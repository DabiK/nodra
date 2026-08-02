import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { MissionProviderSessionCapabilitiesView, MissionView, ProviderSessionDetailView } from "../types";
import {
  activateMissionProviderSession,
  ensureMissionObservationSession,
  loadMissionProviderSession,
  loadMissionProviderSessionCapabilities,
  startMissionProviderTurn,
  steerMissionProviderTurn
} from "../services/mission-provider-session-service";
import { showMission } from "../services/mission-service";

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

function itemLabel(item: ProviderSessionDetailView["snapshot"]["items"][number], providerId: string) {
  if (item.role === "user") return "Vous";
  if (item.role === "assistant" && item.kind === "message") return providerLabel(providerId);
  if (item.role === "assistant") return `${providerLabel(providerId)} · activité`;
  if (item.role === "tool") return "Outil";
  return item.role || "Activité";
}

function ProviderItem({ item, providerId }: { item: ProviderSessionDetailView["snapshot"]["items"][number]; providerId: string }) {
  const message = item.kind === "message";
  const user = item.role === "user";
  const tool = !message && (item.kind === "tool_call" || item.kind === "tool_result");
  return (
    <article className={`provider-thread-item ${user ? "user" : message ? "assistant" : "tool"}`} data-external-item-id={item.externalItemId}>
      <header><strong>{itemLabel(item, providerId)}</strong><span>{item.kind} · {item.externalItemId}</span></header>
      {item.name ? <code>{item.name}</code> : null}
      <p className={tool ? "provider-thread-tool-text" : undefined}>{item.text ?? "—"}</p>
    </article>
  );
}

function ProviderFeed({ detail, busy }: { detail: ProviderSessionDetailView | null; busy: boolean }) {
  if (!detail) return <div className="conversation-empty">Connexion au fil provider…</div>;
  const { turns, items } = detail.snapshot;
  const providerId = detail.identity.providerId;
  return <>
    {turns.map((turn) => (
      <section className="provider-thread-turn" data-external-turn-id={turn.externalTurnId} key={turn.externalTurnId}>
        <header><strong>Tour {turn.order}</strong><span className={isActiveTurn(turn.state) ? "active" : ""}>{turn.state}</span><code>{turn.externalTurnId}</code></header>
        <div>{items.filter((item) => item.externalTurnId === turn.externalTurnId).map((item) => <ProviderItem item={item} providerId={providerId} key={item.externalItemId} />)}</div>
      </section>
    ))}
    {items.filter((item) => item.externalTurnId === null).map((item) => <ProviderItem item={item} providerId={providerId} key={item.externalItemId} />)}
    {!turns.length && !items.length ? <div className="conversation-empty">La conversation ne contient encore aucun élément.</div> : null}
    {busy ? <div className="provider-thread-sync" role="status">Synchronisation avec le provider…</div> : null}
  </>;
}

export function ProviderMissionConversationPage({ missionId }: { missionId: string }) {
  const [mission, setMission] = useState<MissionView | null>(null);
  const [detail, setDetail] = useState<ProviderSessionDetailView | null>(null);
  const [control, setControl] = useState<MissionProviderSessionCapabilitiesView | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"send" | "steer" | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [connected, setConnected] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const activationRef = useRef(false);
  const commandRef = useRef<{ kind: "send" | "steer"; text: string; id: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      let nextMission = await showMission(missionId);
      if (nextMission.state === "READY" && !activationRef.current) {
        activationRef.current = true;
        await activateMissionProviderSession(missionId, nextMission.version, commandId());
        nextMission = await showMission(missionId);
      }
      let nextDetail: ProviderSessionDetailView | null = null;
      try {
        nextDetail = await loadMissionProviderSession(missionId);
      } catch (reason) {
        const message = (reason as Error).message;
        if (message.includes("has no active provider session")) {
          try {
            await ensureMissionObservationSession(missionId, commandId());
            nextDetail = await loadMissionProviderSession(missionId);
          } catch {
            setMission(nextMission);
            setDetail(null);
            setControl(null);
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
      setMission(nextMission);
      setDetail(nextDetail);
      setControl(nextControl);
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
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [detail?.snapshot.cursor, detail?.snapshot.items.length, detail?.snapshot.turns.length]);

  const activeTurn = useMemo(() => [...(detail?.snapshot.turns ?? [])].reverse().find((turn) => isActiveTurn(turn.state)) ?? null, [detail]);
  const canControl = detail?.link?.mode === "control";
  const canStartTurn = Boolean(detail?.link && capabilityAvailable(control?.capabilities.startTurn.state));
  const canSteer = Boolean(detail?.link && detail?.snapshot.session.state === "active" && activeTurn && capabilityAvailable(control?.capabilities.steer.state));

  const execute = async (kind: "send" | "steer") => {
    const value = text.trim();
    if (!value || busy || (kind === "send" ? !canStartTurn : !canSteer || !activeTurn)) return;
    const previous = commandRef.current;
    const id = previous?.kind === kind && previous.text === value ? previous.id : commandId();
    commandRef.current = { kind, text: value, id };
    setBusy(kind);
    setError("");
    try {
      if (kind === "steer" && activeTurn) await steerMissionProviderTurn(missionId, activeTurn.externalTurnId, value, id);
      else await startMissionProviderTurn(missionId, value, id);
      commandRef.current = null;
      setText("");
      await refresh();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(null);
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
            <div className="conversation-actions"><button type="button" className="ghost-button" onClick={() => void refresh()}>Rafraîchir</button><a className="ghost-button" href="/?page=provider-sessions">Sessions provider</a><a className="ghost-button" href="/">← Missions</a></div>
          </header>
          {error ? <p className="inspector-error" role="alert">{error}</p> : null}
          {pending ? <p className="inspector-note" role="status">{pending}</p> : null}
          <div className="provider-thread-source"><span>Source de vérité provider</span><code>{detail?.identity.externalSessionRef ?? missionId}</code></div>
          <div className="conversation-feed-wrap"><div className="agent-conversation provider-thread-feed" ref={feedRef} aria-live="polite"><ProviderFeed detail={detail} busy={busy !== null} /></div></div>
          <footer className="composer-wrap">
            <form className="agent-composer" onSubmit={submit}>
              <textarea rows={2} maxLength={20000} value={text} onChange={(event) => setText(event.target.value)} placeholder="Écris une instruction au provider…" onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
              <div className="composer-bottom">
                <div className="composer-options"><span className="thread-label">{detail?.identity.externalSessionRef ?? "session provider"}</span></div>
                <div className="composer-actions">{canSteer ? <button type="button" className="steer-button" disabled={!text.trim() || busy !== null} onClick={() => void execute("steer")}>{busy === "steer" ? "Steer…" : "↳ Steer le tour actif"}</button> : null}<button type="submit" className="send-button" disabled={!text.trim() || !canStartTurn || busy !== null}>{busy === "send" ? "Envoi…" : "Envoyer un nouveau tour"} <span>⌘↵</span></button></div>
              </div>
            </form>
            <p className="permission-note">Chaque envoi crée directement un tour chez le provider. Aucune file locale n’est utilisée.</p>
          </footer>
        </section>
      </main>
    </div>
  );
}
