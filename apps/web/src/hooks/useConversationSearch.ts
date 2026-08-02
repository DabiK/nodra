import { useEffect, useMemo, useRef, useState } from "react";
import { findMatches, type SearchableMessage, type SearchMatch } from "../services/conversation-search-service";

/**
 * État de recherche d'un fil de conversation : requête, occurrences, curseur
 * précédent/suivant (avec bouclage). Les messages doivent exposer leurs champs
 * recherchables (texte, tool calls, événements…) via `SearchableMessage`.
 */
export function useConversationSearch(messages: SearchableMessage[]) {
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(0);
  const previousQuery = useRef(query);

  const matches = useMemo(() => findMatches(query, messages), [query, messages]);

  // Une nouvelle requête (ou une édition) repart de la première occurrence.
  useEffect(() => {
    if (previousQuery.current === query) return;
    previousQuery.current = query;
    setCurrent(0);
  }, [query]);

  // Le curseur reste dans les bornes quand le résultat rétrécit (rafraîchissement SSE…).
  useEffect(() => {
    if (matches.length === 0) {
      if (current !== 0) setCurrent(0);
      return;
    }
    if (current >= matches.length) setCurrent(matches.length - 1);
  }, [matches.length, current]);

  const activeMatch: SearchMatch | null = current < matches.length ? matches[current] : null;

  const next = () => {
    if (matches.length > 0) setCurrent((value) => (value + 1) % matches.length);
  };
  const prev = () => {
    if (matches.length > 0) setCurrent((value) => (value - 1 + matches.length) % matches.length);
  };
  const clear = () => {
    setQuery("");
    setCurrent(0);
  };

  return { query, setQuery, matches, matchCount: matches.length, current, activeMatch, next, prev, clear };
}
