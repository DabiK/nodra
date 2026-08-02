import type { KeyboardEvent } from "react";

export interface ConversationSearchBarProps {
  query: string;
  matchCount: number;
  /** Occurrence active (0-based). */
  current: number;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

/**
 * Barre de recherche d'un fil de conversation : saisie, compteur d'occurrences
 * et navigation précédent/suivant (Entrée / Maj+Entrée, Échap pour fermer).
 */
export function ConversationSearchBar({
  query,
  matchCount,
  current,
  onQueryChange,
  onNext,
  onPrev,
  onClose
}: ConversationSearchBarProps) {
  const searching = query.trim() !== "";
  const label = !searching
    ? ""
    : matchCount > 0
      ? `${current + 1} / ${matchCount}`
      : "Aucun résultat";
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) onPrev();
      else onNext();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };
  return (
    <div className="conversation-search-bar" role="search" aria-label="Rechercher dans la conversation">
      <input
        className="conversation-search-input"
        type="text"
        role="searchbox"
        placeholder="Rechercher (texte, tool calls, événements)…"
        value={query}
        autoFocus
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="conversation-search-count" role="status" aria-live="polite">{label}</span>
      <button
        type="button"
        className="conversation-search-nav"
        aria-label="Occurrence précédente (Maj+Entrée)"
        title="Occurrence précédente (Maj+Entrée)"
        disabled={matchCount === 0}
        onClick={onPrev}
      >↑</button>
      <button
        type="button"
        className="conversation-search-nav"
        aria-label="Occurrence suivante (Entrée)"
        title="Occurrence suivante (Entrée)"
        disabled={matchCount === 0}
        onClick={onNext}
      >↓</button>
      <button
        type="button"
        className="conversation-search-close"
        aria-label="Fermer la recherche (Échap)"
        title="Fermer la recherche (Échap)"
        onClick={onClose}
      >✕</button>
    </div>
  );
}
