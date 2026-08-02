import { useEffect, useRef } from "react";

const SHORTCUTS: Array<{ keys: string; description: string }> = [
  { keys: "⌘ K / Ctrl K", description: "Ouvre la palette de commandes (créer une mission, naviguer, lancer/avancer un run, accepter une delivery)" },
  { keys: "?", description: "Affiche cette aide des raccourcis clavier" },
  { keys: "Esc", description: "Ferme la palette, l'aide ou la fiche mission" },
  { keys: "← / →", description: "Sur le board : déplace le focus entre les colonnes (flèches)" },
  { keys: "↵", description: "Dans le champ « Confier une tâche » : crée la mission" },
  { keys: "↵", description: "Dans la palette : exécute la commande sélectionnée" },
  { keys: "↑ / ↓", description: "Dans la palette : navigue dans les commandes" }
];

const PALETTE_ACTIONS = [
  "Créer une mission — ouvre le formulaire de capture",
  "Aller aux Tâches / Pipelines / Managers / Sessions provider",
  "Démarrer ou avancer le run d'une pipeline",
  "Accepter la delivery d'une mission en validation",
  "Ouvrir la fiche d'une mission"
];

/**
 * Overlay d'aide « ? » : documente les raccourcis clavier et les commandes de
 * la palette. Accessible (role="dialog" + aria-modal), fermé par Esc, par le
 * bouton × ou par un clic sur le fond.
 */
export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose(): void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="help-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="helpTitle">
        <header>
          <div>
            <h2 id="helpTitle">Raccourcis clavier</h2>
            <p>La palette de commandes se pilote entièrement au clavier.</p>
          </div>
          <button type="button" ref={closeRef} className="icon-button" aria-label="Fermer l'aide" onClick={onClose}>×</button>
        </header>

        <section aria-label="Raccourcis">
          <h3>Raccourcis</h3>
          {SHORTCUTS.map((shortcut, index) => (
            <div className="help-shortcut" key={index}>
              <kbd>{shortcut.keys}</kbd>
              <span>{shortcut.description}</span>
            </div>
          ))}
        </section>

        <section aria-label="Commandes de la palette">
          <h3>Dans la palette (⌘K)</h3>
          {PALETTE_ACTIONS.map((action) => (
            <div className="help-shortcut" key={action}>
              <kbd>⌘K</kbd>
              <span>{action}</span>
            </div>
          ))}
        </section>
      </section>
    </div>
  );
}
