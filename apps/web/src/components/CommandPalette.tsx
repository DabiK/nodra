import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { filterPaletteCommands, groupPaletteCommands, type PaletteCommand } from "../services/palette-service";

/**
 * Palette de commandes Cmd+K.
 * Accessible : role="dialog" + aria-modal, listbox + options navigables au
 * clavier (↑/↓, Home/End, Entrée), focus déplacé dans le champ de recherche à
 * l'ouverture et restitué à l'élément précédent à la fermeture.
 */
export function CommandPalette({
  open,
  commands,
  status,
  onClose,
  onSelect
}: {
  open: boolean;
  commands: PaletteCommand[];
  status?: string;
  onClose(): void;
  onSelect(command: PaletteCommand): void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => filterPaletteCommands(commands, query), [commands, query]);
  const groups = useMemo(() => groupPaletteCommands(filtered), [filtered]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => previous?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex >= filtered.length) return;
    const option = listRef.current?.querySelector(`[data-palette-index="${activeIndex}"]`);
    option?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, filtered.length, open]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (!filtered.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(filtered.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = filtered[activeIndex];
      if (command) onSelect(command);
    }
  };

  const listboxId = "palette-listbox";

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        className="palette-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Palette de commandes"
        onKeyDown={handleKeyDown}
      >
        <header>
          <span className="palette-prompt" aria-hidden="true">⌘</span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            placeholder="Tape une commande ou recherche…"
            aria-label="Rechercher une commande"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={filtered[activeIndex] ? `palette-option-${activeIndex}` : undefined}
          />
          <button type="button" className="icon-button" aria-label="Fermer la palette" onClick={onClose}>×</button>
        </header>

        <ul className="palette-list" id={listboxId} role="listbox" ref={listRef} aria-label="Commandes disponibles">
          {groups.map((entry) => (
            <li className="palette-group" role="presentation" key={entry.group}>
              <span className="palette-group-label">{entry.group}</span>
              {entry.commands.map((command) => {
                const index = filtered.indexOf(command);
                const selected = index === activeIndex;
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    id={`palette-option-${index}`}
                    data-palette-index={index}
                    className={`palette-option${selected ? " selected" : ""}`}
                    key={command.id}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => onSelect(command)}
                  >
                    <span className="palette-option-label">{command.label}</span>
                    <span className="palette-option-hint">{command.hint}</span>
                  </button>
                );
              })}
            </li>
          ))}
          {!filtered.length && <li className="palette-empty" role="presentation">Aucune commande ne correspond à « {query} ».</li>}
        </ul>

        <footer>
          {status ? <span className="palette-status">{status}</span> : <span>↑↓ naviguer · ↵ exécuter · esc fermer</span>}
        </footer>
      </section>
    </div>
  );
}
