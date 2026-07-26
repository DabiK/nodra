import type { Id } from "@nodra/domain";

export type ProviderReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "provider_default";

export type ProviderPermissionPreset = "read_only" | "workspace" | "full_access";

export interface ProviderCapability {
  available: boolean;
  reason: string | null;
}

export interface ProviderContractCapability extends ProviderCapability {
  status: "certified" | "compatible_unverified" | "incompatible";
  expectedVersion: string;
  currentVersion: string | null;
  action: string | null;
}

export interface ProviderCapabilities {
  schemaVersion: 1;
  providerId: string;
  version: string;
  availability: ProviderCapability;
  authentication: ProviderCapability;
  models: ProviderCapability;
  contract: ProviderContractCapability;
  start: ProviderCapability;
  events: ProviderCapability;
  cancel: ProviderCapability;
  resume: ProviderCapability;
  steer: ProviderCapability & { mode: "immediate" | "enqueue" | "none" };
  usage: ProviderCapability & { kind: "reported" | "estimated" | "none" };
  attachments: ProviderCapability;
  mcp: ProviderCapability;
  permissionInterception: ProviderCapability;
  optionsSchemaVersion: number;
}

export interface ProviderModel {
  id: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  supportedReasoningEfforts: ProviderReasoningEffort[];
  defaultReasoningEffort: ProviderReasoningEffort;
}

export interface ProviderHealth {
  status: "ready" | "degraded" | "unavailable";
  reason: string | null;
  actionRequired:
    | "update_required"
    | "authenticate"
    | "discover_models"
    | "install_or_start_binary"
    | null;
}

export interface ProviderProbeResult {
  providerId: string;
  adapterVersion: string;
  binaryVersion: string | null;
  authenticated: boolean;
  authKind: string | null;
  health: ProviderHealth;
  capabilities: ProviderCapabilities;
  models: ProviderModel[];
  probedAt: string;
}

export interface ProviderCatalogSnapshot extends ProviderProbeResult {
  catalogVersion: string;
}

export interface ProviderRunConfiguration {
  runId: Id;
  providerId: string;
  modelId: string;
  reasoningEffort: ProviderReasoningEffort;
  prompt: string;
  cwd: string;
  permissionPreset: ProviderPermissionPreset;
  capabilityVersion: string;
  contractStatus: ProviderContractCapability["status"];
  session: { externalId: string } | null;
}

export interface ProviderEventInput {
  type: string;
  payload: unknown;
  occurredAt: string;
}

export interface ProviderPermissionRequest {
  requestId: string | number;
  action: string;
  target: Record<string, unknown>;
  cwd: string | null;
  risk: string;
  providerRequest: unknown;
}

export interface ProviderExecutionSink {
  session(externalId: string): Promise<void>;
  runRef(externalId: string): Promise<void>;
  event(event: ProviderEventInput): Promise<void>;
  permission(request: ProviderPermissionRequest): Promise<unknown>;
}

export interface ProviderExecutionResult {
  state: "SUCCEEDED" | "FAILED" | "CANCELLED";
  externalSessionId: string;
  externalRunId: string;
}
