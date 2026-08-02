export interface ServerEvent {
  type: string;
  [key: string]: unknown;
}

export function serverEventsSupported(): boolean {
  return typeof EventSource !== "undefined";
}

/**
 * Ouvre le flux SSE temps réel (`/api/events/stream`) et appelle `onEvent`
 * pour chaque événement reçu. Le backend envoie :
 *  - `hello` à chaque connexion (resynchronisation, notamment après une
 *    reconnexion automatique d'EventSource),
 *  - `data_changed` quand des données ont changé (mutations HTTP + écritures
 *    base de données),
 *  - `ping` périodique (garder la connexion vivante — à ignorer).
 *
 * Retourne une fonction de désabonnement. Si `EventSource` n'est pas
 * disponible (environnement sans SSE), retourne un no-op.
 */
export function subscribeToServerEvents(onEvent: (event: ServerEvent) => void): () => void {
  if (!serverEventsSupported()) return () => undefined;
  const source = new EventSource("/api/events/stream");
  source.addEventListener("message", (message) => {
    try {
      const payload = JSON.parse((message as MessageEvent<string>).data) as ServerEvent;
      if (payload && typeof payload.type === "string") onEvent(payload);
    } catch {
      // trame illisible ou non JSON : on ignore
    }
  });
  return () => source.close();
}
