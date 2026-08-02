import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MissionView, ProviderSessionCapabilities, ProviderSessionDetailView, ProviderSessionListItem, ProviderSessionListView } from "../types";
import { attachProviderSession, createProviderSessionMission, getProviderSessionCapabilities, listProviderSessions, refreshProviderSession, showProviderSession } from "../services/provider-session-service";
import { providerLabel } from "../services/provider-label";
import { ProviderSessionAttachDialog } from "./ProviderSessionAttachDialog";
import { ProviderSessionCapabilityBanner } from "./ProviderSessionCapabilityBanner";
import { ProviderSessionDetail } from "./ProviderSessionDetail";
import { ProviderSessionList } from "./ProviderSessionList";
import { useSseRefresh } from "../hooks/useSseRefresh";

const PROVIDER_IDS = ["codex", "opencode"] as const;
type Filter = "all" | (typeof PROVIDER_IDS)[number];

function byUpdatedDesc(a: ProviderSessionListItem, b: ProviderSessionListItem) {
  const aTime = Date.parse(a.summary.sourceUpdatedAt ?? "") || -Infinity;
  const bTime = Date.parse(b.summary.sourceUpdatedAt ?? "") || -Infinity;
  return bTime - aTime;
}

export function ProviderSessionsPage({ missions, initialSessionId, onSessionChange, onOpenMission }: { missions: MissionView[]; initialSessionId: string | null; onSessionChange(id: string): void; onOpenMission(missionId: string): void }) {
  const [capabilities, setCapabilities] = useState<Record<string, ProviderSessionCapabilities | null>>({});
  const [listings, setListings] = useState<Record<string, ProviderSessionListView | null>>({});
  const [providerErrors, setProviderErrors] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<ProviderSessionDetailView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialSessionId);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [attachError, setAttachError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const refreshingRef = useRef(false);

  const select = async (id: string) => {
    setSelectedId(id); onSessionChange(id); setDetail(null); setError("");
    try { setDetail(await showProviderSession(id)); } catch (reason) { setError((reason as Error).message); }
  };
  const reloadLists = useCallback(async () => {
    const results = await Promise.allSettled(PROVIDER_IDS.map((providerId) => listProviderSessions(providerId).then((nextList) => setListings((prev) => ({ ...prev, [providerId]: nextList })))));
    const nextErrors: Record<string, string> = {};
    results.forEach((result, index) => {
      if (result.status === "rejected") nextErrors[PROVIDER_IDS[index]] = result.reason instanceof Error ? result.reason.message : "Erreur inconnue";
    });
    setProviderErrors((prev) => ({ ...prev, ...nextErrors }));
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const localListings: Record<string, ProviderSessionListView> = {};
      const results = await Promise.allSettled(PROVIDER_IDS.map(async (providerId) => {
        const nextCapabilities = await getProviderSessionCapabilities(providerId);
        if (!cancelled) setCapabilities((prev) => ({ ...prev, [providerId]: nextCapabilities }));
        if (nextCapabilities.listSessions.state === "unavailable" || nextCapabilities.readSession.state === "unavailable") return;
        const nextList = await listProviderSessions(providerId);
        localListings[providerId] = nextList;
        if (!cancelled) setListings((prev) => ({ ...prev, [providerId]: nextList }));
      }));
      if (cancelled) return;
      const errors: Record<string, string> = {};
      results.forEach((result, index) => {
        if (result.status === "rejected") errors[PROVIDER_IDS[index]] = result.reason instanceof Error ? result.reason.message : "Erreur inconnue";
      });
      setProviderErrors(errors);
      const merged = Object.values(localListings).flatMap((item) => item.sessions).sort(byUpdatedDesc);
      const id = initialSessionId && merged.some((session) => session.id === initialSessionId) ? initialSessionId : merged[0]?.id;
      if (id) await select(id);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  // Chargement au montage uniquement ; les rafraîchissements suivants sont
  // pilotés par le flux SSE (temps réel) et par le bouton "Rafraîchir".
  }, []);
  const refresh = useCallback(async () => {
    if (!selectedId || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true); setError("");
    try { setDetail(await refreshProviderSession(selectedId)); await reloadLists(); } catch (reason) { setError((reason as Error).message); } finally { refreshingRef.current = false; setRefreshing(false); }
  }, [reloadLists, selectedId]);
  // Temps réel : le flux SSE remplace le polling toutes les 10 s.
  useSseRefresh(() => void refresh());
  const afterAttach = async (operation: () => Promise<unknown>) => {
    if (!selectedId || submitting) return;
    setSubmitting(true); setAttachError("");
    try { await operation(); await reloadLists(); setDetail(await showProviderSession(selectedId)); setAttachOpen(false); } catch (reason) { setAttachError((reason as Error).message); } finally { setSubmitting(false); }
  };
  const mergedSessions = useMemo(() => PROVIDER_IDS.flatMap((providerId) => listings[providerId]?.sessions ?? []).sort(byUpdatedDesc), [listings]);
  const counts = useMemo(() => {
    const perProvider: Record<string, number> = {};
    for (const providerId of PROVIDER_IDS) perProvider[providerId] = listings[providerId]?.sessions.length ?? 0;
    return perProvider;
  }, [listings]);
  const visibleSessions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return mergedSessions.filter((session) => {
      if (filter !== "all" && session.summary.ref.providerId !== filter) return false;
      if (!query) return true;
      return [
        session.id,
        session.summary.ref.externalSessionId,
        session.summary.ref.providerId,
        session.summary.title,
        session.summary.cwd,
        session.summary.state
      ].some((value) => value?.toLocaleLowerCase().includes(query));
    });
  }, [mergedSessions, search, filter]);
  return <>
    <header className="hero-row provider-sessions-hero"><div><p className="date-label">SESSIONS OBSERVÉES</p><h1>Conversations observées</h1><p className="subtitle">Des snapshots de sessions Codex et OpenCode, présentés comme un fil de discussion.</p></div><div className="focus-score provider-sessions-count"><span>{mergedSessions.length}</span><small>sessions<br />observées</small></div></header>
    {PROVIDER_IDS.map((providerId) => <ProviderSessionCapabilityBanner key={providerId} capabilities={capabilities[providerId] ?? null} providerId={providerId} />)}
    {error ? <p className="provider-session-page-error" role="alert">{error}</p> : null}
    {PROVIDER_IDS.map((providerId) => providerErrors[providerId] ? <p key={providerId} className="provider-session-page-error" role="alert">{providerErrors[providerId]}</p> : null)}
    <nav className="provider-session-tabs" aria-label="Filtrer par fournisseur">
      <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}><span>Toutes</span><span className="provider-session-tab-count">{mergedSessions.length}</span></button>
      {PROVIDER_IDS.map((providerId) => <button type="button" key={providerId} className={filter === providerId ? "active" : ""} onClick={() => setFilter(providerId)}><span>{providerLabel(providerId)}</span><span className="provider-session-tab-count">{counts[providerId] ?? 0}</span></button>)}
    </nav>
    {loading ? <p className="empty">Chargement des sessions…</p> : <div className="provider-sessions-layout"><aside className="panel provider-sessions-pane"><div className="provider-sessions-pane-head"><div><span className="eyebrow">BOÎTE DE RÉCEPTION</span><h2>Sessions</h2></div><span className="provider-sessions-pane-count" aria-label={`${visibleSessions.length} sessions`}>{visibleSessions.length}</span></div><p className="provider-sessions-pane-note">Choisis une conversation pour consulter son dernier snapshot.</p><label className="provider-session-search"><span>Recherche</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Titre, ID ou répertoire…" aria-label="Rechercher une session" /></label><ProviderSessionList sessions={visibleSessions} selectedId={selectedId} onSelect={(id) => void select(id)} /></aside><ProviderSessionDetail detail={detail} refreshing={refreshing} onRefresh={() => void refresh()} onAttach={() => { setAttachError(""); setAttachOpen(true); }} onOpenMission={onOpenMission} /></div>}
    {attachOpen && selectedId ? <ProviderSessionAttachDialog missions={missions} suggestedTitle={detail?.snapshot.session.title} workspacePath={detail?.snapshot.session.cwd} submitting={submitting} error={attachError} onClose={() => setAttachOpen(false)} onAttach={(input) => afterAttach(() => attachProviderSession(selectedId, input))} onCreate={(input) => afterAttach(() => createProviderSessionMission(selectedId, input))} /> : null}
  </>;
}
