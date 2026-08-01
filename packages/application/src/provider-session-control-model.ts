import type { ProviderSessionRef, ProviderSessionSyncCapability } from "./provider-session-sync-model.js";

export interface ProviderSessionControlCapabilities {
  schemaVersion: 1;
  providerId: string;
  read: ProviderSessionSyncCapability;
  startTurn: ProviderSessionSyncCapability;
  steer: ProviderSessionSyncCapability;
  queue: ProviderSessionSyncCapability;
}

export interface ProviderSessionStartTurnInput {
  ref: ProviderSessionRef;
  text: string;
  clientCommandId: string;
}

export interface ProviderSessionSteerInput extends ProviderSessionStartTurnInput {
  externalTurnId: string;
}

export interface ProviderSessionTurnCommandResult {
  ref: ProviderSessionRef;
  externalTurnId: string;
}
