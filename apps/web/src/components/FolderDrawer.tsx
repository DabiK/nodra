import type { FolderBrowseResult } from "../types";

export function FolderDrawer({
  browse,
  loading,
  onBrowse,
  onSelect,
  onClose
}: {
  browse: FolderBrowseResult | null;
  loading: boolean;
  onBrowse(path?: string): void;
  onSelect(path: string): void;
  onClose(): void;
}) {
  return (
    <div
      className="task-folder-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="task-folder-drawer" aria-label="Explorateur de dossiers">
        <header>
          <div>
            <span className="eyebrow">WORKSPACE</span>
            <h2>Choisir un dossier</h2>
            <p>{browse?.current ?? "Chargement de l'explorateur local..."}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer l'explorateur">×</button>
        </header>

        <div className="folder-view-switch" role="group" aria-label="Racines rapides">
          {browse?.roots.map((root) => (
            <button type="button" onClick={() => onBrowse(root)} key={root}>
              {root.split(/[/\\]/).filter(Boolean).at(-1) || root}
            </button>
          ))}
        </div>

        <nav aria-label="Dossiers">
          {browse?.parent && (
            <button type="button" onClick={() => onBrowse(browse.parent ?? undefined)}>
              <span className="folder-glyph">↰</span>
              <span>
                <strong>Parent</strong>
                <small>{browse.parent}</small>
              </span>
            </button>
          )}
          {browse?.entries.map((entry) => (
            <button type="button" onClick={() => onBrowse(entry.path)} key={entry.path}>
              <span className="folder-glyph">▰</span>
              <span>
                <strong>{entry.name}</strong>
                <small>{entry.path}</small>
              </span>
            </button>
          ))}
          {loading && <p className="empty">Chargement...</p>}
        </nav>

        <footer>
          <button type="button" disabled={!browse} onClick={() => browse && onSelect(browse.current)}>
            Utiliser ce dossier
          </button>
        </footer>
      </aside>
    </div>
  );
}
