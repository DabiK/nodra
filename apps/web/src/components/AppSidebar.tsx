type Page = "tasks" | "pipelines" | "managers";

/**
 * Presentational left navigation. Collapsible: when `collapsed` is true only
 * the brand mark, the toggle and the nav icons remain; labels are hidden via
 * CSS and the main area reclaims the freed space.
 */
export function AppSidebar({
  page,
  collapsed,
  activePipelineCount,
  hasActiveManager,
  onToggle,
  onNavigate
}: {
  page: Page;
  collapsed: boolean;
  activePipelineCount: number;
  hasActiveManager: boolean;
  onToggle(): void;
  onNavigate(page: Page): void;
}) {
  const go = (target: Page) => (event: { preventDefault(): void }) => {
    event.preventDefault();
    onNavigate(target);
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
      </nav>
    </aside>
  );
}
