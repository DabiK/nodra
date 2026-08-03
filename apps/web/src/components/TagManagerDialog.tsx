import { useCallback, useEffect, useState } from "react";
import { createTag, deleteTag, loadTags, TAG_COLOR_PALETTE, updateTag, type MissionTag } from "../services/tag-service";

/**
 * Gestionnaire de tags libres (issue #23) : créer, renommer, recolorer,
 * supprimer. Ouvert depuis le panneau Tags de la fiche mission.
 */
export function TagManagerDialog({
  open,
  onClose,
  onChanged
}: {
  open: boolean;
  onClose(): void;
  /** Notifie le parent (panneau tags) qu'un tag a changé — recharge les listes. */
  onChanged(): void;
}) {
  const [tags, setTags] = useState<MissionTag[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState<string>(TAG_COLOR_PALETTE[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editColor, setEditColor] = useState<string>(TAG_COLOR_PALETTE[0]);

  const reload = useCallback(async () => {
    try {
      setTags(await loadTags());
      setLoaded(true);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError("");
    setNewLabel("");
    setNewColor(TAG_COLOR_PALETTE[0]);
    setEditingId(null);
    void reload();
  }, [open, reload]);

  // Escape ferme le dialog ; le garde de la fiche (MissionInspector) ne se
  // déclenche pas tant que showTagManager est vrai.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      await reload();
      onChanged();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newLabel.trim()) return;
    void run(() => createTag({ label: newLabel.trim(), color: newColor }));
    setNewLabel("");
  };

  const startEdit = (tag: MissionTag) => {
    setEditingId(tag.id);
    setEditLabel(tag.label);
    setEditColor(tag.color);
  };

  const handleSaveEdit = (tagId: string) => {
    if (!editLabel.trim()) return;
    void run(() => updateTag({ id: tagId, label: editLabel.trim(), color: editColor }));
    setEditingId(null);
  };

  const handleDelete = (tagId: string) => {
    void run(() => deleteTag(tagId));
    if (editingId === tagId) setEditingId(null);
  };

  return (
    <div className="tag-manager-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="tag-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="tagManagerTitle">
        <header>
          <div>
            <span className="eyebrow">TAGS LIBRES</span>
            <h3 id="tagManagerTitle">Gérer les tags</h3>
          </div>
          <button type="button" className="tag-manager-close" aria-label="Fermer" onClick={onClose}>×</button>
        </header>

        {error && <p className="tag-manager-error" role="alert">{error}</p>}

        <form className="tag-manager-create" onSubmit={handleCreate}>
          <input
            aria-label="Libellé du nouveau tag"
            placeholder="Nouveau tag (ex. urgent, client-x…)"
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            maxLength={40}
          />
          <div className="tag-manager-palette" role="group" aria-label="Couleur du nouveau tag">
            {TAG_COLOR_PALETTE.map((color) => (
              <button
                type="button"
                key={color}
                className={`tag-swatch${newColor === color ? " selected" : ""}`}
                style={{ background: color }}
                aria-label={color}
                aria-pressed={newColor === color}
                onClick={() => setNewColor(color)}
              />
            ))}
          </div>
          <button type="submit" className="primary-button" disabled={busy || !newLabel.trim()}>
            {busy ? "..." : "＋ Créer"}
          </button>
        </form>

        <ul className="tag-manager-list" aria-label="Tags existants">
          {!loaded && <li className="empty">Chargement…</li>}
          {loaded && tags.length === 0 && <li className="empty">Aucun tag pour le moment — créez le premier ci-dessus.</li>}
          {tags.map((tag) => (
            <li className="tag-manager-row" key={tag.id}>
              {editingId === tag.id ? (
                <>
                  <input
                    aria-label={`Libellé du tag ${tag.id}`}
                    value={editLabel}
                    onChange={(event) => setEditLabel(event.target.value)}
                    maxLength={40}
                  />
                  <div className="tag-manager-palette" role="group" aria-label="Couleur du tag">
                    {TAG_COLOR_PALETTE.map((color) => (
                      <button
                        type="button"
                        key={color}
                        className={`tag-swatch small${editColor === color ? " selected" : ""}`}
                        style={{ background: color }}
                        aria-label={color}
                        aria-pressed={editColor === color}
                        onClick={() => setEditColor(color)}
                      />
                    ))}
                  </div>
                  <button type="button" className="tag-manager-save" disabled={busy || !editLabel.trim()} onClick={() => handleSaveEdit(tag.id)}>✓</button>
                  <button type="button" className="tag-manager-cancel" disabled={busy} onClick={() => setEditingId(null)}>✕</button>
                </>
              ) : (
                <>
                  <span className="mission-tag-chip" style={{ ["--tag-color" as string]: tag.color }}>
                    <i className="tag-dot" aria-hidden="true" />
                    {tag.label}
                  </span>
                  <span className="tag-manager-meta">{tag.color}</span>
                  <button type="button" className="tag-manager-edit" disabled={busy} aria-label={`Renommer ou recolorer ${tag.label}`} onClick={() => startEdit(tag)}>✎</button>
                  <button type="button" className="tag-manager-delete" disabled={busy} aria-label={`Supprimer le tag ${tag.label}`} onClick={() => handleDelete(tag.id)}>🗑</button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
