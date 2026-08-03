import type { Id, MissionState } from "@nodra/domain";

/**
 * Hub d'activité (issue #13) : agrège les items du relay qui requièrent une
 * décision humaine — missions en VALIDATION ou BLOCKED, deliveries à accepter,
 * approbations en attente, transitions de pipeline à approuver.
 *
 * Le relay (`relay_item`) matérialise déjà ces sources : la queue
 * `decision_required` (mission_decision_required, agent_result_requires_validation,
 * delivery_pending, approval_pending, pipeline_waiting_human_validation,
 * pipeline_transition_requires_human) et la queue `blocked` (missions bloquées,
 * runs échoués/annulés, nœud de pipeline en échec).
 */
export type ActivityQueue = "blocked" | "decision_required";

export interface ActivityMissionSubject {
  kind: "mission";
  mission: {
    id: Id;
    title: string;
    executionKind: "human" | "agent";
    state: MissionState;
    updatedAt: string;
  };
}

export interface ActivityPipelineSubject {
  kind: "pipeline";
  pipelineId: Id;
  pipelineName: string;
}

export type ActivitySubject = ActivityMissionSubject | ActivityPipelineSubject;

export interface ActivityItemView {
  relayId: Id;
  queue: ActivityQueue;
  state: "unread" | "read" | "snoozed";
  reasonCode: string;
  createdAt: string;
  readAt: string | null;
  subject: ActivitySubject;
}

export interface ActivityView {
  items: ActivityItemView[];
  unreadCount: number;
}

export interface ActivityRepository {
  list(): Promise<ActivityView>;
  /** Marque un item comme lu. Retourne false si l'item n'existe pas (ou est résolu). */
  markRead(relayId: Id, readAt: string): Promise<boolean>;
}
