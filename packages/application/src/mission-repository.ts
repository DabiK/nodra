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

/** Événement d'audit d'une mission (timeline, cf. issue #11). */
export interface MissionAuditView {
  id: Id;
  commandId: Id;
  eventType: string;
  actor: "user" | "manager";
  payload: Readonly<Record<string, unknown>>;
  occurredAt: string;
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
  /** État du dernier run de la mission (null si aucun run). */
  runState: string | null;
  /** Début du dernier run de la mission (null si aucun run). */
  runStartedAt: string | null;
  /** Dernier message assistant du dernier run s'il est encore actif, null sinon. */
  lastAssistantMessage: string | null;
}

export interface RelayMissionView extends MissionView {
  reasonCode: string;
}

/** Un run de mission avec son usage (tokens) et son coût. */
export interface MissionRunView {
  id: Id;
  attempt: number;
  state: string;
  providerId: string;
  modelId: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costMicros: number | null;
  usageKind: string | null;
}

/** Historique des runs d'une mission (du plus ancien au plus récent) + coût total cumulé. */
export interface MissionRunsView {
  runs: MissionRunView[];
  totalCostMicros: number | null;
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
  runs(id: Id): Promise<MissionRunsView>;
  /** Timeline d'audit de la mission, du plus ancien au plus récent. */
  audit(id: Id): Promise<MissionAuditView[]>;
}
