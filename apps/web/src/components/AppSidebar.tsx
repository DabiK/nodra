export type AppPage = "tasks" | "pipelines" | "managers" | "provider-sessions";

export type Theme = "light" | "dark";

export interface SidebarMission {
  id: string;
  title: string;
  state: string;
}

/**
 * Presentational left navigation. Collapsible: when `collapsed` is true only
 * the brand mark, the toggle and the nav icons remain; labels are hidden via
 * CSS and the main area reclaims the freed space.
 */
export function AppSidebar({
  page,
  collapsed,
  theme,
  activePipelineCount,
  hasActiveManager,
  missions,
  query,
  onQueryChange,
  onToggle,
  onNavigate,
  onSelectMission,
  onThemeToggle
}: {
  page: AppPage;
  collapsed: boolean;
  theme: Theme;
  activePipelineCount: number;
  hasActiveManager: boolean;
  missions: SidebarMission[];
  query?: string;
  onQueryChange?(query: string): void;
  onToggle(): void;
  onNavigate(page: AppPage): void;
  onSelectMission(missionId: string): void;
  onThemeToggle(): void;
}) {
  const go = (target: AppPage) => (event: { preventDefault(): void }) => {
    event.preventDefault();
    onNavigate(target);
  };
  const openMission = (missionId: string) => (event: { preventDefault(): void }) => {
    event.preventDefault();
    onSelectMission(missionId);
  };
  return (
    <aside className="sidebar" aria-label="Navigation">
      <div className="brand">
        <span>N</span>
        <div>
          <strong>Nodra</strong>
          <small>Mission control</small>
        </div>
      </div>
      <button
        type="button"
        className="sidebar-toggle"
        aria-label={collapsed ? "Déplier la barre latérale" : "Replier la barre latérale"}
        aria-expanded={!collapsed}
        aria-controls="sidebar-nav"
        title={collapsed ? "Déplier" : "Replier"}
        onClick={onToggle}
      >
        <span aria-hidden="true">{collapsed ? "»" : "«"}</span>
      </button>
      <nav id="sidebar-nav">
        <a className={page === "tasks" ? "active" : ""} href="/" title="Flux · Tâches" onClick={go("tasks")}>
          <span className="nav-icon" aria-hidden="true">☰</span>
          <span className="nav-label">Flux · Tâches</span>
        </a>
        <a className={page === "pipelines" ? "active" : ""} href="/?page=pipelines" title="Pipelines" onClick={go("pipelines")}>
          <span className="nav-icon" aria-hidden="true">⑃</span>
          <span className="nav-label">Pipelines</span>
          {activePipelineCount ? <span className="count">{activePipelineCount}</span> : null}
        </a>
        <a className={page === "managers" ? "active" : ""} href="/?page=managers" title="Managers" onClick={go("managers")}>
          <span className="nav-icon" aria-hidden="true">✦</span>
          <span className="nav-label">Managers</span>
          {hasActiveManager ? <span className="count">•</span> : null}
        </a>
        <a className={page === "provider-sessions" ? "active" : ""} href="/?page=provider-sessions" title="Sessions provider" onClick={go("provider-sessions")}>
          <span className="nav-icon" aria-hidden="true">◫</span>
          <span className="nav-label">Sessions provider</span>
        </a>
      </nav>
      {page === "tasks" ? (
        <div className="sidebar-search">
          <span className="sidebar-search-icon" aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query ?? ""}
            onChange={(event) => onQueryChange?.(event.target.value)}
            placeholder="Rechercher des missions…"
            aria-label="Rechercher dans les missions"
          />
        </div>
      ) : null}
      {missions.length > 0 ? (
        <div className="sidebar-missions" aria-label="Missions actives">
          <span className="sidebar-section-label">Missions actives</span>
          <ul>
            {missions.map((mission) => (
              <li key={mission.id}>
                <a href="/" title={mission.title} onClick={openMission(mission.id)}>
                  <span className={`sidebar-mission-dot state-${mission.state.toLowerCase()}`} aria-hidden="true" />
                  <span className="sidebar-mission-title">{mission.title}</span>
                  <span className="sidebar-mission-state">{mission.state}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="sidebar-theme">
        <button
          type="button"
          className="theme-toggle"
          aria-label={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
          title={theme === "dark" ? "Mode clair" : "Mode sombre"}
          onClick={onThemeToggle}
        >
          <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
          <span className="theme-toggle-label">{theme === "dark" ? "Mode clair" : "Mode sombre"}</span>
        </button>
      </div>
    </aside>
  );
}
