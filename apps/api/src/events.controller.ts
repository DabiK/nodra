import { Controller, Inject, Sse, type MessageEvent } from "@nestjs/common";
import { interval, map, merge, of, type Observable } from "rxjs";
import { SseEventsService, type ServerEvent } from "./sse-events.service.js";

const HEARTBEAT_INTERVAL_MS = 25_000;

const toMessageEvent = (payload: ServerEvent): MessageEvent => ({ data: payload });

/**
 * `GET /api/events/stream` — flux SSE temps réel.
 *
 * Chaque connexion reçoit :
 *  - un événement `hello` à l'ouverture (le client peut s'en servir pour
 *    resynchroniser après une reconnexion),
 *  - les événements `data_changed` publiés par le hub (mutations HTTP +
 *    écritures base de données),
 *  - un `ping` périodique pour garder la connexion vivante à travers les
 *    proxies. Le front ignore volontairement les `ping`.
 */
@Controller("api/events")
export class EventsController {
  constructor(@Inject(SseEventsService) private readonly events: SseEventsService) {}

  @Sse("stream")
  stream(): Observable<MessageEvent> {
    return merge(
      of<ServerEvent>({ type: "hello", receivedAt: new Date().toISOString() }),
      this.events.changes$,
      interval(HEARTBEAT_INTERVAL_MS).pipe(
        map<number, ServerEvent>(() => ({ type: "ping", receivedAt: new Date().toISOString() }))
      )
    ).pipe(map(toMessageEvent));
  }
}
