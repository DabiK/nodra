import { Injectable } from "@nestjs/common";
import { Subject } from "rxjs";

export interface ServerEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Bus d'événements temps réel partagé par les clients SSE.
 *
 * Sources d'événements `data_changed` :
 *  - les mutations HTTP (`create-app.ts`, middleware global),
 *  - les écritures base de données (`DatabaseChangeWatcher`, y compris celles
 *    du process worker / des agents).
 *
 * Chaque client connecté sur `GET /api/events/stream` reçoit ces événements et
 * rafraîchit ses données — c'est ce qui remplace le polling du front.
 */
@Injectable()
export class SseEventsService {
  private readonly subject = new Subject<ServerEvent>();
  readonly changes$ = this.subject.asObservable();

  publish(event: ServerEvent): void {
    this.subject.next(event);
  }
}
