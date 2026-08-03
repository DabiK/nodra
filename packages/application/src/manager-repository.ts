import type { Id, Manager, ManagerState } from "@nodra/domain";

export interface ManagerAuditRecord {
  id: Id;
  commandId: Id;
  eventType: string;
  actor: "user" | "manager";
  payload: Readonly<Record<string, unknown>>;
  occurredAt: string;
}

export interface SaveManagerInput {
  manager: Manager;
  mode: "create" | "update";
  audit: ManagerAuditRecord;
}

export interface ManagerRepository {
  load(id: Id): Promise<Manager | null>;
  save(input: SaveManagerInput): Promise<void>;
}

export interface ManagerListFilter {
  projectId?: Id | null;
  includeArchived?: boolean;
}

export interface ManagerView {
  id: Id;
  projectId: Id | null;
  name: string;
  instruction: string;
  state: ManagerState;
  providerId: string | null;
  modelId: string | null;
  reasoningEffort: string | null;
  permissionPreset: "read_only" | "workspace" | "full_access";
  workspaceId: Id | null;
  workspacePath: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  activeRunId: string | null;
  currentThreadId: string | null;
  lastMessage: string | null;
  conversationCount: number;
}

export interface ManagerConversationTurn {
  runId: string;
  state: string;
  createdAt: string;
  endedAt: string | null;
  summary: string | null;
}

export interface ManagerConversationView {
  id: string;
  managerId: string;
  createdAt: string;
  current: boolean;
  providerSessionRef: string | null;
  threadId: string;
  turns: ManagerConversationTurn[];
}

export type ManagerTimelineItemKind = "user" | "assistant" | "tool" | "system" | "steer" | "result";

export interface ManagerTimelineItemView {
  id: string;
  conversationId: string;
  managerId: string;
  managerName: string;
  managerState: string;
  kind: ManagerTimelineItemKind;
  body: string | null;
  createdAt: string;
}

export interface ManagerTimelineFilter {
  managerId?: Id;
  /** Messages dont le corps mentionne cet identifiant de mission (les conversations
   * manager ne portent pas de mission_id : la mention est le seul lien disponible). */
  missionId?: Id;
  /** Recherche plein texte (LIKE) sur le corps des messages. */
  query?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export interface ManagerTimelineView {
  items: ManagerTimelineItemView[];
  truncated: boolean;
}

export interface ManagerReadModel {
  list(filter?: ManagerListFilter): Promise<ManagerView[]>;
  show(id: Id): Promise<ManagerView | null>;
  conversations(id: Id): Promise<ManagerConversationView[]>;
  timeline(filter: ManagerTimelineFilter): Promise<ManagerTimelineView>;
}
