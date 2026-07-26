import type { Id, MissionSnapshot } from "@nodra/domain";
import type {
  ProviderCapabilities,
  ProviderCatalogSnapshot,
  ProviderPermissionPreset,
  ProviderReasoningEffort
} from "./provider-model.js";

export interface AgentConfig {
  missionId: Id;
  version: number;
  providerId: string | null;
  modelId: string | null;
  reasoningEffort: ProviderReasoningEffort | null;
  providerOptions: { schemaVersion: number; value: Record<string, unknown> };
  missionPrompt: string;
  permissionPreset: ProviderPermissionPreset | null;
  workspaceId: Id | null;
  autoCommitAuthorized: boolean;
  integrationTargetRef: string | null;
  updatedAt: string;
}

export interface AgentConfigValues {
  providerId: string;
  modelId: string;
  reasoningEffort: ProviderReasoningEffort;
  providerOptions: { schemaVersion: number; value: Record<string, unknown> };
  missionPrompt: string;
  permissionPreset: ProviderPermissionPreset;
  workspaceId: Id;
  autoCommitAuthorized: boolean;
  integrationTargetRef: string | null;
}

export interface AgentConfigResolutionSource {
  mission: MissionSnapshot;
  config: AgentConfig;
  workspace: { id: Id; path: string; state: string } | null;
  attachmentsRequested: boolean;
  mcpRequested: boolean;
}

export interface AgentConfigBlockingError {
  code:
    | "AGENT_CONFIG_REQUIRED"
    | "CAPABILITY_UNAVAILABLE"
    | "CONFIG_SCHEMA_UNSUPPORTED"
    | "CONFIG_RESOLUTION_FAILED"
    | "WORKSPACE_STATE_CONFLICT";
  field: string;
  reason: string;
}

export interface ResolvedAgentConfig {
  configVersion: number;
  providerId: string;
  modelId: string;
  reasoningEffort: ProviderReasoningEffort;
  providerOptions: { schemaVersion: number; value: Record<string, unknown> };
  missionPrompt: string;
  permissionPreset: ProviderPermissionPreset;
  workspaceId: Id;
  cwd: string;
  autoCommitAuthorized: boolean;
  integrationTargetRef: string | null;
  catalogVersion: string;
}

export interface AgentConfigPreview {
  requested: AgentConfig;
  resolved: ResolvedAgentConfig | null;
  provenance: Record<string, "mission">;
  capabilities: ProviderCapabilities | null;
  blockingErrors: AgentConfigBlockingError[];
  catalog: ProviderCatalogSnapshot | null;
}
