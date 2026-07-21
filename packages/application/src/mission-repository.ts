import type { Id, Mission, MissionState } from "@nodra/domain";

export type RelayQueue = "ready" | "active" | "blocked" | "decision_required";

export interface MissionAuditRecord {
  id: Id;
  commandId: Id;
  eventType: string;
  actor: "user" | "manager";
  payload: Readonly<Record<string, unknown>>;
  occurredAt: string;
}

export interface MissionOutboxRecord {
  id: Id;
  kind: "mission.changed";
  dedupeKey: string;
  payload: Readonly<Record<string, unknown>>;
  createdAt: string;
}

export interface MissionRelayRecord {
  id: Id;
  queue: RelayQueue;
  reasonCode: string;
  createdAt: string;
}

export interface SaveMissionInput {
  mission: Mission;
  expectedVersion: number;
  audit: MissionAuditRecord;
  outbox: MissionOutboxRecord;
  relay: MissionRelayRecord | null;
}

export interface MissionRepository {
  load(id: Id): Promise<Mission | null>;
  save(input: SaveMissionInput): Promise<void>;
}

export interface MissionListFilter {
  projectId?: Id | null;
}

export interface MissionView {
  id: Id;
  projectId: Id | null;
  title: string;
  executionKind: "human" | "agent";
  state: MissionState;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RelayMissionView extends MissionView {
  reasonCode: string;
}

export interface RelayProjection {
  ready: RelayMissionView[];
  active: RelayMissionView[];
  blocked: RelayMissionView[];
  decision_required: RelayMissionView[];
}

export interface MissionReadModel {
  list(filter?: MissionListFilter): Promise<MissionView[]>;
  show(id: Id): Promise<MissionView | null>;
  relay(filter?: MissionListFilter): Promise<RelayProjection>;
}
