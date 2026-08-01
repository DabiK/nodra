import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MissionView, ProviderSessionCapabilities, ProviderSessionDetailView, ProviderSessionListView } from "../types";
import { attachProviderSession, createProviderSessionMission, getProviderSessionCapabilities, listProviderSessions, refreshProviderSession, showProviderSession } from "../services/provider-session-service";
import { ProviderSessionAttachDialog } from "./ProviderSessionAttachDialog";
import { ProviderSessionCapabilityBanner } from "./ProviderSessionCapabilityBanner";
import { ProviderSessionDetail } from "./ProviderSessionDetail";
import { ProviderSessionList } from "./ProviderSessionList";

export function ProviderSessionsPage({ missions, initialSessionId, onSessionChange, onOpenMission }: { missions: MissionView[]; initialSessionId: string | null; onSessionChange(id: string): void; onOpenMission(missionId: string): void }) {
  const [capabilities, setCapabilities] = useState<ProviderSessionCapabilities | null>(null);
  const [listing, setListing] = useState<ProviderSessionListView | null>(null);
  const [detail, setDetail] = useState<ProviderSessionDetailView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialSessionId);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [attachError, setAttachError] = useState("");
  const [search, setSearch] = useState("");
  const refreshingRef = useRef(false);

  const loadList = useCallback(async () => {
    const next = await listProviderSessions();
    setListing(next);
    return next;
  }, []);
  const select = async (id: string) => {
    setSelectedId(id); onSessionChange(id); setDetail(null); setError("");
    try { setDetail(await showProviderSession(id)); } catch (reason) { setError((reason as Error).message); }
  };
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const nextCapabilities = await getProviderSessionCapabilities();
        if (cancelled) return;
        setCapabilities(nextCapabilities);
        if (nextCapabilities.listSessions.state === "unavailable" || nextCapabilities.readSession.state === "unavailable") return;
        const nextList = await loadList();
        if (cancelled) return;
        const id = initialSessionId && nextList.sessions.some((session) => session.id === initialSessionId) ? initialSessionId : nextList.sessions[0]?.id;
        if (id) await select(id);
      } catch (reason) {
        if (!cancelled) setError((reason as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // Manual load only: this page intentionally has no timer or stream subscription.
  }, []);
  const refresh = useCallback(async () => {
    if (!selectedId || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true); setError("");
    try { setDetail(await refreshProviderSession(selectedId)); await loadList(); } catch (reason) { setError((reason as Error).message); } finally { refreshingRef.current = false; setRefreshing(false); }
  }, [loadList, selectedId]);
  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh, selectedId]);
  const afterAttach = async (operation: () => Promise<unknown>) => {
    if (!selectedId || submitting) return;
    setSubmitting(true); setAttachError("");
    try { await operation(); await loadList(); setDetail(await showProviderSession(selectedId)); setAttachOpen(false); } catch (reason) { setAttachError((reason as Error).message); } finally { setSubmitting(false); }
  };
  const unavailable = capabilities?.listSessions.state === "unavailable" || capabilities?.readSession.state === "unavailable";
  const visibleSessions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return listing?.sessions ?? [];
    return (listing?.sessions ?? []).filter((session) => [
      session.id,
      session.summary.ref.externalSessionId,
      session.summary.title,
      session.summary.cwd,
      session.summary.state
    ].some((value) => value?.toLocaleLowerCase().includes(query)));
  }, [listing, search]);
  return <>
    <header className="hero-row provider-sessions-hero"><div><p className="date-label">CODEX · LECTURE SEULE</p><h1>Conversations observées</h1><p className="subtitle">Des snapshots de sessions Codex, présentés comme un fil de discussion — sans prise de contrôle.</p></div><div className="focus-score provider-sessions-count"><span>{listing?.sessions.length ?? 0}</span><small>sessions<br />observées</small></div></header>
    <ProviderSessionCapabilityBanner capabilities={capabilities} />
    {error ? <p className="provider-session-page-error" role="alert">{error}</p> : null}
    {loading ? <p className="empty">Chargement des sessions Codex…</p> : unavailable ? null : <div className="provider-sessions-layout"><aside className="panel provider-sessions-pane"><div className="provider-sessions-pane-head"><div><span className="eyebrow">BOÎTE DE RÉCEPTION</span><h2>Sessions</h2></div><span className="provider-sessions-pane-count" aria-label={`${listing?.sessions.length ?? 0} sessions`}>{listing?.sessions.length ?? 0}</span></div><p className="provider-sessions-pane-note">Choisis une conversation pour consulter son dernier snapshot.</p><label className="provider-session-search"><span>Recherche</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Titre ou ID Codex…" aria-label="Rechercher une session Codex" /></label><ProviderSessionList sessions={visibleSessions} selectedId={selectedId} onSelect={(id) => void select(id)} /></aside><ProviderSessionDetail detail={detail} refreshing={refreshing} onRefresh={() => void refresh()} onAttach={() => { setAttachError(""); setAttachOpen(true); }} onOpenMission={onOpenMission} /></div>}
    {attachOpen && selectedId ? <ProviderSessionAttachDialog missions={missions} suggestedTitle={detail?.snapshot.session.title} workspacePath={detail?.snapshot.session.cwd} submitting={submitting} error={attachError} onClose={() => setAttachOpen(false)} onAttach={(input) => afterAttach(() => attachProviderSession(selectedId, input))} onCreate={(input) => afterAttach(() => createProviderSessionMission(selectedId, input))} /> : null}
  </>;
}
