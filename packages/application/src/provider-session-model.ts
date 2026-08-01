import type { Id, MissionSnapshot } from "@nodra/domain";
import type { AgentConfig } from "./agent-config-model.js";

export type ProviderSessionOwnership = "external_observed";
export type ProviderSessionLinkMode = "read_only" | "control";

export interface ProviderSessionIdentity {
  id: Id;
  providerId: string;
  externalSessionRef: string;
  ownership: ProviderSessionOwnership;
  firstObservedAt: string;
  lastObservedAt: string;
}

export interface ProviderSessionLink {
  id: Id;
  providerSessionId: Id;
  missionId: Id;
  mode: ProviderSessionLinkMode;
  attachedAt: string;
  detachedAt: string | null;
}

export interface ObserveProviderSessionInput {
  id: Id;
  providerId: string;
  externalSessionRef: string;
  observedAt: string;
}

export interface AttachProviderSessionInput {
  providerSessionId: Id;
  missionId: Id;
  commandId: Id;
  actor: "user" | "manager";
  occurredAt: string;
}

export interface CreateReadyAgentMissionAndAttachInput extends AttachProviderSessionInput {
  title: string;
  requestedTitle: string | null;
  projectId?: Id | null;
  cwd: string;
  missionPrompt: string;
}

export interface ProviderSessionAttachmentResult {
  session: ProviderSessionIdentity;
  link: ProviderSessionLink;
}

export interface ActivateProviderSessionMissionInput {
  missionId: Id;
  commandId: Id;
  actor: "user" | "manager";
  expectedVersion: number;
  occurredAt: string;
}

export interface ActivatedProviderSessionMissionResult {
  session: ProviderSessionIdentity;
  link: ProviderSessionLink;
  mission: MissionSnapshot;
}

export interface CreatedProviderSessionMissionResult extends ProviderSessionAttachmentResult {
  mission: MissionSnapshot;
  config: AgentConfig;
  workspace: { id: Id; projectId: Id | null; kind: "repo"; path: string; state: "ready" };
}
