import type {
  ActivatedProviderSessionMissionResult,
  ActivateProviderSessionMissionInput
} from "./provider-session-model.js";

export interface ProviderSessionControlRepository {
  activateMissionControl(input: ActivateProviderSessionMissionInput): Promise<ActivatedProviderSessionMissionResult>;
}
