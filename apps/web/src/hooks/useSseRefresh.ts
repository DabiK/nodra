import { useEffect, useRef } from "react";
import { serverEventsSupported, subscribeToServerEvents, type ServerEvent } from "../services/events-service";

/** Filet de sécurité : rafraîchissement lent uniquement si le SSE est indisponible. */
const FALLBACK_POLL_MS = 30_000;

/**
 * Remplace le polling des composants : chaque événement temps réel
 * (`data_changed` / `hello`) déclenche un rafraîchissement de `refresh`.
 *
 * - Les rafales d'événements sont coalescées dans un même tick.
 * - Les `ping` (heartbeat) sont ignorés : ils ne servent qu'à garder la
 *   connexion vivante.
 * - Sans `EventSource` (environnement non supporté, tests jsdom), on retombe
 *   sur un intervalle de secours lent pour garder l'UI à jour.
 *
 * `refresh` est stocké dans une ref : le composant peut le redéfinir à chaque
 * rendu sans re-s'abonner au flux.
 */
export function useSseRefresh(refresh: () => void): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const pending = { current: false };
    const onEvent = (event: ServerEvent) => {
      if (event.type === "ping") return;
      if (pending.current) return;
      pending.current = true;
      queueMicrotask(() => {
        pending.current = false;
        refreshRef.current();
      });
    };
    const unsubscribe = subscribeToServerEvents(onEvent);
    let fallback: number | undefined;
    if (!serverEventsSupported()) {
      fallback = window.setInterval(() => refreshRef.current(), FALLBACK_POLL_MS);
    }
    return () => {
      unsubscribe();
      if (fallback !== undefined) window.clearInterval(fallback);
    };
  }, []);
}
