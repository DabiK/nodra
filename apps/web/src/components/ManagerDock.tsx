import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ManagerView } from "../types";
import { sendManagerMessage } from "../services/manager-service";

const stateCopy: Record<string, string> = {
  draft: "à configurer",
  ready: "prêt",
  active: "en orchestration",
  blocked: "a besoin d'aide"
};

export function ManagerDock({
  managers,
  onManage,
  onOpen,
  onChanged
}: {
  managers: ManagerView[];
  onManage(): void;
  onOpen(managerId: string): void;
  onChanged(): void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const active = managers.filter((manager) => manager.state !== "archived");
  const selected = useMemo(() => active.find((manager) => manager.id === selectedId) ?? active[0], [active, selectedId]);
  const anyRunning = active.some((manager) => manager.state === "active");

  useEffect(() => {
    if (!selectedId && active[0]) setSelectedId(active[0].id);
  }, [active, selectedId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !prompt.trim()) return;
    setBusy(true);
    setError("");
    try {
      await sendManagerMessage(selected.id, { message: prompt.trim(), threadId: selected.currentThreadId });
      setPrompt("");
      onChanged();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`manager-dock${open ? " open" : ""}`}>
      {open && (
        <section className="manager-dock-panel" role="dialog" aria-label="Accès rapide aux managers">
          <header>
            <div>
              <span>GUILD CHANNEL</span>
              <strong>{selected?.name ?? "Aucun manager"}</strong>
            </div>
            <button aria-label="Fermer" onClick={() => setOpen(false)}>×</button>
          </header>
          {!selected ? (
            <div className="manager-dock-empty">
              <p>Crée un chef d'équipe pour lui déléguer l'orchestration de DevFlow.</p>
              <button onClick={() => { setOpen(false); onManage(); }}>Créer mon premier manager</button>
            </div>
          ) : (
            <>
              <div className="manager-dock-switcher">
                {active.map((manager) => (
                  <button key={manager.id} className={manager.id === selected.id ? "active" : ""} onClick={() => setSelectedId(manager.id)}>
                    <i className={`dot dot-${manager.state}`} />
                    <span>{manager.name}<small>{stateCopy[manager.state] ?? manager.state}</small></span>
                  </button>
                ))}
              </div>
              {selected.lastMessage && <div className="manager-dock-last">{selected.lastMessage}</div>}
              <form onSubmit={submit}>
                <textarea rows={3} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Qu'est-ce qu'on orchestre ?" aria-label="Brief rapide au manager" />
                {error && <small className="manager-error">{error}</small>}
                <div>
                  <button type="button" onClick={() => { setOpen(false); onOpen(selected.id); }}>Ouvrir ↗</button>
                  <button type="submit" disabled={busy || !prompt.trim()}>{busy ? "…" : selected.state === "active" ? "Ajouter →" : "Envoyer →"}</button>
                </div>
              </form>
            </>
          )}
        </section>
      )}
      <button className="manager-dock-trigger" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="manager-dock-glyph">◑</span>
        <span>
          <b>{anyRunning ? "En orchestration" : "Besoin d'un chef ?"}</b>
          <small>{active.length ? `${active.length} manager${active.length > 1 ? "s" : ""}` : "Créer ton équipe"}</small>
        </span>
        <i>{open ? "×" : "↗"}</i>
      </button>
    </div>
  );
}
