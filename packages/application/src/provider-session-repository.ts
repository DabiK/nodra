import type { Id } from "@nodra/domain";
import type {
  AttachProviderSessionInput,
  CreateReadyAgentMissionAndAttachInput,
  CreatedProviderSessionMissionResult,
  ObserveProviderSessionInput,
  ProviderSessionAttachmentResult,
  ProviderSessionIdentity,
  ProviderSessionLink
} from "./provider-session-model.js";

export interface ProviderSessionRepository {
  observe(input: ObserveProviderSessionInput): Promise<ProviderSessionIdentity>;
  load(id: Id): Promise<ProviderSessionIdentity | null>;
  loadActiveLink(providerSessionId: Id): Promise<ProviderSessionLink | null>;
  listActiveLinksForMission(missionId: Id): Promise<ProviderSessionLink[]>;
  attachToMission(input: AttachProviderSessionInput): Promise<ProviderSessionAttachmentResult>;
  createReadyAgentMissionAndAttach(
    input: CreateReadyAgentMissionAndAttachInput
  ): Promise<CreatedProviderSessionMissionResult>;
}
