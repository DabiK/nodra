import { useEffect, useState } from "react";

/** Breakpoint tablette : en deçà, le board bascule en liste et la sidebar devient un drawer. */
export const TABLET_BREAKPOINT = "(max-width: 768px)";

/**
 * Suit une requête média CSS (`window.matchMedia`).
 *
 * - Réagit aux changements en direct (resize, rotation, fenêtre redimensionnée).
 * - Retourne `false` quand `matchMedia` est indisponible (tests jsdom, anciens
 *   navigateurs) : les écrans desktop restent le comportement par défaut.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
