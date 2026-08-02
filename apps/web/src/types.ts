export type MissionState =
  | "DRAFT"
  | "BACKLOG"
  | "READY"
  | "ACTIVE"
  | "BLOCKED"
  | "VALIDATION"
  | "DONE"
  | "ABANDONED";

export interface MissionView {
  id: string;
  projectId: string | null;
  title: string;
  executionKind: "human" | "agent";
  state: MissionState;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentConfigView {
  missionId: string;
  version: number;
  providerId: string | null;
  modelId: string | null;
  reasoningEffort: ProviderReasoningEffort | null;
  providerOptions: { schemaVersion: number; value: Record<string, unknown> };
  missionPrompt: string;
  permissionPreset: ProviderPermissionPreset | null;
  workspaceId: string | null;
  autoCommitAuthorized: boolean;
  integrationTargetRef: string | null;
  updatedAt: string;
}

export interface ProviderHealth {
  status: "ready" | "degraded" | "unavailable" | "not_probed";
  reason: string | null;
}

export type ProviderReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "provider_default";
export type ProviderPermissionPreset = "read_only" | "workspace" | "full_access";

export interface ProviderModelOption {
  id: string;
  label: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  supportedReasoningEfforts: ProviderReasoningEffort[];
  defaultReasoningEffort: ProviderReasoningEffort;
}

export interface ProviderOption {
  id: string;
  label: string;
  status: ProviderHealth["status"];
  reason: string | null;
  models: ProviderModelOption[];
}

export interface ProviderOptionsCatalog {
  providers: ProviderOption[];
  reasoningEfforts: ProviderReasoningEffort[];
  permissionPresets: ProviderPermissionPreset[];
  defaults: {
    providerId: string;
    modelId: string;
    reasoningEffort: ProviderReasoningEffort;
    permissionPreset: ProviderPermissionPreset;
    providerOptions: { schemaVersion: number; value: Record<string, unknown> };
  };
}

export interface MissionIntakeDraft {
  title: string;
  kind: "agent" | "human";
  prompt: string;
  notes: string;
  projectId: string;
  workspaceKind: WorkspaceDraftKind;
  workspacePath: string;
  workspaceName: string;
  sourceWorkspaceId: string;
  sourceRepositoryPath: string;
  baseRef: string;
  branchName: string;
  providerId: string;
  modelId: string;
  reasoningEffort: ProviderReasoningEffort;
  permissionPreset: ProviderPermissionPreset;
}

export type WorkspaceDraftKind = "repo" | "scratch" | "worktree";

export interface FolderBrowseResult {
  current: string;
  parent: string | null;
  roots: string[];
  selectedName: string;
  entries: Array<{ name: string; path: string; selectable: boolean }>;
}

export interface WorkspaceRecord {
  id: string;
  projectId: string | null;
  kind: "repo" | "scratch" | "worktree";
  path: string;
  state: string;
}

export interface CreateWorkspaceInput {
  kind: WorkspaceRecord["kind"];
  path?: string;
  projectId?: string;
  sourceWorkspaceId?: string;
  sourceRepositoryPath?: string;
  baseRef?: string;
  branchName?: string;
  integrationTargetRef?: string | null;
}

export interface PipelineView {
  id: string;
  name: string;
}

export type PipelineNodeRunState = "pending" | "ready" | "active" | "blocked" | "completed" | "failed" | "skipped";

export interface PipelineListNode {
  nodeKey: string;
  missionId: string;
  missionTitle: string;
  missionKind: string;
  missionState: MissionState;
  nodeRunState: PipelineNodeRunState | null;
  transitionMode: "auto" | "human";
  runStartedAt: string | null;
  runEndedAt: string | null;
  runAttempt: number | null;
  /** Coût du dernier run de la mission (micro-dollars), null si inconnu. */
  runCostMicros: number | null;
}

export interface PipelineListItem {
  id: string;
  name: string;
  state: "draft" | "active" | "completed" | "archived";
  createdAt: string;
  runId: string | null;
  runState: "queued" | "active" | "blocked" | "completed" | "failed" | "cancelled" | "archived" | null;
  startedAt: string | null;
  endedAt: string | null;
  /** Somme des coûts connus des nœuds (micro-dollars), null si aucun. */
  totalCostMicros: number | null;
  nodes: PipelineListNode[];
  edges: Array<{ fromNodeKey: string; toNodeKey: string }>;
}

export interface AgentSessionView {
  run: {
    id: string;
    missionId: string | null;
    conversationId: string;
    state: string;
    providerId: string;
    modelId: string;
    reasoningEffort?: string | null;
    providerRunRef: string | null;
    createdAt: string;
    startedAt: string | null;
    endedAt: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    cacheReadTokens?: number | null;
    cacheWriteTokens?: number | null;
    costMicros?: number | null;
  };
  conversation: {
    id: string;
    providerSessionRef: string | null;
    state: string;
  } | null;
  config?: {
    promptEffective: string;
    promptMission: string | null;
    cwd: string;
    permissionPreset: string;
  } | null;
  items: Array<{
    id: string;
    kind: string;
    body: string | null;
    createdAt: string;
  }>;
  events: Array<{
    id: string;
    sequence: number;
    type: string;
    payload: unknown;
    sourceAt: string | null;
    receivedAt: string;
  }>;
}

export interface MissionInspectorData {
  mission: MissionView;
  config: AgentConfigView | null;
  providerSession: ProviderSessionDetailView | null;
}

/** Un run de mission avec son usage (tokens) et son coût, tel qu'exposé par l'API. */
export interface MissionRunView {
  id: string;
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

/** Historique des runs d'une mission + coût total cumulé. */
export interface MissionRunsView {
  runs: MissionRunView[];
  totalCostMicros: number | null;
}

export type ManagerState = "draft" | "ready" | "active" | "blocked" | "archived";

export interface ManagerView {
  id: string;
  projectId: string | null;
  name: string;
  instruction: string;
  state: ManagerState;
  providerId: string | null;
  modelId: string | null;
  reasoningEffort: string | null;
  permissionPreset: ProviderPermissionPreset;
  workspaceId: string | null;
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

export interface ManagerThreadView {
  manager: ManagerView | null;
  conversation: { id: string; providerSessionRef: string | null; state: string } | null;
  run: AgentSessionView["run"] | null;
  config: { promptEffective: string; promptManagerInstruction: string | null; cwd: string; permissionPreset: string } | null;
  items: Array<{ id: string; kind: string; body: string | null; createdAt: string }>;
  events: AgentSessionView["events"];
  threadId: string;
}

export type ProviderSessionCapabilityState = "certified" | "compatible_unverified" | "unavailable";

export interface ProviderSessionCapability {
  state: ProviderSessionCapabilityState;
  reason: string | null;
  action: string | null;
}

export interface ProviderSessionCapabilities {
  schemaVersion: 1;
  providerId: string;
  listSessions: ProviderSessionCapability;
  readSession: ProviderSessionCapability;
  readHistory: ProviderSessionCapability;
  subscribe: ProviderSessionCapability;
  cursorResume: ProviderSessionCapability;
  attachedControl: ProviderSessionCapability;
}

export interface ProviderSessionSummaryView {
  ref: { providerId: string; externalSessionId: string };
  title: string | null;
  cwd: string | null;
  state: "active" | "idle" | "archived" | "unknown";
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  receivedAt: string;
}

export interface ProviderSessionListItem {
  id: string;
  summary: ProviderSessionSummaryView;
  link: { id: string; providerSessionId?: string; missionId: string; mode: "read_only" | "control"; attachedAt: string; detachedAt: string | null } | null;
}

export interface ProviderSessionListView {
  sessions: ProviderSessionListItem[];
  nextCursor: string | null;
}

export interface ProviderSubagentTranscriptItemView {
  externalItemId: string;
  role: string;
  kind: string;
  order: number;
  text: string | null;
  name: string | null;
  sourceAt: string | null;
}

export interface ProviderSubagentExecutionView {
  subSessionId: string;
  status: string;
  model: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  report: string | null;
  transcript: ProviderSubagentTranscriptItemView[];
}

export interface ProviderSessionDetailView {
  identity: { id: string; providerId: string; externalSessionRef: string; ownership: "external_observed"; firstObservedAt: string; lastObservedAt: string };
  snapshot: {
    session: ProviderSessionSummaryView;
    turns: Array<{ externalTurnId: string; order: number; state: string; sourceStartedAt: string | null; sourceCompletedAt: string | null; receivedAt: string }>;
    items: Array<{ externalItemId: string; externalTurnId: string | null; role: string; kind: string; order: number; text: string | null; name: string | null; sourceAt: string | null; receivedAt: string; subagent?: ProviderSubagentExecutionView | null }>;
    cursor: string | null;
  };
  link: ProviderSessionListItem["link"];
  capabilities: ProviderSessionCapabilities;
}

export interface ProviderSessionControlCapabilities {
  schemaVersion: 1;
  providerId: string;
  read: ProviderSessionCapability;
  startTurn: ProviderSessionCapability;
  steer: ProviderSessionCapability;
  queue: ProviderSessionCapability;
}

export interface MissionProviderSessionCapabilitiesView {
  identity: ProviderSessionDetailView["identity"];
  link: NonNullable<ProviderSessionDetailView["link"]>;
  capabilities: ProviderSessionControlCapabilities;
}

export interface ProviderSessionTurnCommandResult {
  ref: { providerId: string; externalSessionId: string };
  externalTurnId: string;
}
