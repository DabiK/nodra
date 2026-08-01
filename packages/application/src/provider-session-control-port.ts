import type {
  ProviderSessionControlCapabilities,
  ProviderSessionStartTurnInput,
  ProviderSessionSteerInput,
  ProviderSessionTurnCommandResult
} from "./provider-session-control-model.js";

export interface ProviderSessionControlPort {
  readonly providerId: string;
  capabilities(): Promise<ProviderSessionControlCapabilities>;
  startTurn(input: ProviderSessionStartTurnInput): Promise<ProviderSessionTurnCommandResult>;
  steer(input: ProviderSessionSteerInput): Promise<ProviderSessionTurnCommandResult>;
}
