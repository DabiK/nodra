export type ProviderSessionSyncCapabilityState =
  | "certified"
  | "compatible_unverified"
  | "unavailable";

export interface ProviderSessionSyncCapability {
  state: ProviderSessionSyncCapabilityState;
  reason: string | null;
  action: string | null;
}

export interface ProviderSessionSyncCapabilities {
  schemaVersion: 1;
  providerId: string;
  listSessions: ProviderSessionSyncCapability;
  readSession: ProviderSessionSyncCapability;
  readHistory: ProviderSessionSyncCapability;
  subscribe: ProviderSessionSyncCapability;
  cursorResume: ProviderSessionSyncCapability;
  attachedControl: ProviderSessionSyncCapability;
}

/** Provider cursors are opaque and must never be parsed by application code. */
export type ProviderSessionCursor = string;

export interface ProviderSessionRef {
  providerId: string;
  externalSessionId: string;
}

export type ProviderSessionState = "active" | "idle" | "archived" | "unknown";

export interface ProviderSessionSummary {
  ref: ProviderSessionRef;
  title: string | null;
  cwd: string | null;
  state: ProviderSessionState;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  receivedAt: string;
}

export interface ProviderSessionListQuery {
  providerId: string;
  cursor?: ProviderSessionCursor | null;
  limit?: number;
}

export interface ProviderSessionPage {
  sessions: ProviderSessionSummary[];
  nextCursor: ProviderSessionCursor | null;
}

export type ProviderSessionTurnState =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

export interface ProviderSessionTurn {
  externalTurnId: string;
  order: number;
  state: ProviderSessionTurnState;
  sourceStartedAt: string | null;
  sourceCompletedAt: string | null;
  receivedAt: string;
}

export type ProviderSessionItemRole = "user" | "assistant" | "system" | "tool" | "unknown";

export type ProviderSessionItemKind =
  | "message"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "status"
  | "unknown";

export interface ProviderSessionItem {
  externalItemId: string;
  externalTurnId: string | null;
  role: ProviderSessionItemRole;
  kind: ProviderSessionItemKind;
  order: number;
  text: string | null;
  name: string | null;
  sourceAt: string | null;
  receivedAt: string;
}

export interface ProviderSessionSnapshot {
  session: ProviderSessionSummary;
  turns: ProviderSessionTurn[];
  items: ProviderSessionItem[];
  cursor: ProviderSessionCursor | null;
}

export interface ProviderHistoryQuery {
  ref: ProviderSessionRef;
  cursor?: ProviderSessionCursor | null;
  limit?: number;
}

export interface ProviderHistoryPage {
  ref: ProviderSessionRef;
  turns: ProviderSessionTurn[];
  items: ProviderSessionItem[];
  nextCursor: ProviderSessionCursor | null;
}

interface ProviderSessionEventBase {
  ref: ProviderSessionRef;
  cursor: ProviderSessionCursor | null;
  sourceAt: string | null;
  receivedAt: string;
}

export interface ProviderSessionUpsertedEvent extends ProviderSessionEventBase {
  type: "session_upserted";
  session: ProviderSessionSummary;
}

export interface ProviderSessionTurnUpsertedEvent extends ProviderSessionEventBase {
  type: "turn_upserted";
  turn: ProviderSessionTurn;
}

export interface ProviderSessionItemUpsertedEvent extends ProviderSessionEventBase {
  type: "item_upserted";
  item: ProviderSessionItem;
}

export interface ProviderSessionRemovedEvent extends ProviderSessionEventBase {
  type: "session_removed";
}

export interface ProviderSessionCursorInvalidatedEvent extends ProviderSessionEventBase {
  type: "cursor_invalidated";
  reason: string;
}

export type ProviderSessionEvent =
  | ProviderSessionUpsertedEvent
  | ProviderSessionTurnUpsertedEvent
  | ProviderSessionItemUpsertedEvent
  | ProviderSessionRemovedEvent
  | ProviderSessionCursorInvalidatedEvent;

export interface ProviderSubscription {
  ref: ProviderSessionRef;
  cursor?: ProviderSessionCursor | null;
}

export type ProviderSessionSyncErrorCode =
  | "UNAVAILABLE"
  | "NOT_FOUND"
  | "INVALID_CURSOR"
  | "PROTOCOL_INCOMPATIBLE"
  | "ACCESS_DENIED"
  | "TRANSIENT_FAILURE"
  | "UNKNOWN";

export interface ProviderSessionSyncErrorDetails {
  code: ProviderSessionSyncErrorCode;
  providerId: string;
  externalSessionId: string | null;
  retryable: boolean;
  message: string;
}
