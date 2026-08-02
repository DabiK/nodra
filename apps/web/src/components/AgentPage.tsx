import { useCallback, useEffect, useRef, useState } from "react";
import type { MissionView } from "../types";
import { AppSidebar, type AppPage } from "./AppSidebar";
import { loadAgentSession } from "../services/agent-session-service";
import { listMissions } from "../services/mission-service";
import { appShellClassName, loadSidebarCollapsed, saveSidebarCollapsed } from "../services/sidebar-preference-service";
import { ProviderMissionConversationPage } from "./ProviderMissionConversationPage";
import { selectActiveSidebarMissions } from "../services/sidebar-missions";
import { applyTheme, initTheme, saveTheme, type Theme } from "../services/theme-service";
import { useSseRefresh } from "../hooks/useSseRefresh";

function navigateToApp(page: AppPage) {
  location.assign(page === "tasks" ? "/" : `/?page=${page}`);
}

function AgentMissionShell({ missionId }: { missionId: string }) {
  const [missions, setMissions] = useState<MissionView[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => loadSidebarCollapsed());
  const [theme, setTheme] = useState<Theme>(() => initTheme());

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const refreshMissions = useCallback(() => {
    void listMissions()
      .then((next) => { if (mountedRef.current) setMissions(next); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshMissions();
    const onFocus = () => refreshMissions();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshMissions]);

  // Temps réel : le flux SSE remplace le polling toutes les 30 s.
  useSseRefresh(refreshMissions);

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      saveSidebarCollapsed(next);
      return next;
    });
  };

  const toggleTheme = () => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      saveTheme(next);
      applyTheme(next);
      return next;
    });
  };

  return (
    <main className={appShellClassName(sidebarCollapsed)}>
      <AppSidebar
        page="tasks"
        collapsed={sidebarCollapsed}
        theme={theme}
        activePipelineCount={0}
        hasActiveManager={false}
        missions={selectActiveSidebarMissions(missions)}
        onToggle={toggleSidebar}
        onNavigate={navigateToApp}
        onSelectMission={(id) => { location.assign(`/agent.html?missionId=${encodeURIComponent(id)}`); }}
        onThemeToggle={toggleTheme}
      />
      <section className="agent-shell-workspace">
        <ProviderMissionConversationPage missionId={missionId} />
      </section>
    </main>
  );
}

export function AgentPage() {
  const parameters = new URLSearchParams(location.search);
  const missionId = parameters.get("missionId") ?? "";
  const threadId = parameters.get("threadId") ?? "";

  if (missionId) return <AgentMissionShell missionId={missionId} />;
  if (threadId) return <LegacyThreadRedirect threadId={threadId} />;

  return (
    <main className="agent-migration-page">
      <section>
        <span className="eyebrow">CONVERSATION MIGRÉE</span>
        <h1>Cette adresse de run n’est plus utilisée.</h1>
        <p>Les conversations agent s’ouvrent désormais depuis leur mission et affichent directement le fil du provider.</p>
        <a className="primary-button" href="/">Retour aux missions</a>
      </section>
    </main>
  );
}

function LegacyThreadRedirect({ threadId }: { threadId: string }) {
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadAgentSession(threadId)
      .then((session) => {
        if (cancelled) return;
        if (!session.run.missionId) throw new Error("Ce run n’est rattaché à aucune mission.");
        location.replace(`/agent.html?missionId=${encodeURIComponent(session.run.missionId)}`);
      })
      .catch((reason: Error) => { if (!cancelled) setError(reason.message); });
    return () => { cancelled = true; };
  }, [threadId]);

  return (
    <main className="agent-migration-page">
      <section>
        <span className="eyebrow">CONVERSATION PROVIDER</span>
        <h1>Ouverture du fil provider…</h1>
        <p>{error || "Résolution de la mission liée à cette ancienne adresse."}</p>
        {error ? <a className="primary-button" href="/">Retour aux missions</a> : null}
      </section>
    </main>
  );
}
