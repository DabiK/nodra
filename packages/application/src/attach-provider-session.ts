import { requireProviderSessionCommandId } from "./provider-session-command.js";
import type {
  AttachProviderSessionInput,
  ProviderSessionAttachmentResult
} from "./provider-session-model.js";
import type { ProviderSessionRepository } from "./provider-session-repository.js";

export class AttachProviderSession {
  constructor(private readonly sessions: ProviderSessionRepository) {}

  async execute(input: AttachProviderSessionInput): Promise<ProviderSessionAttachmentResult> {
    requireProviderSessionCommandId(input.commandId);
    return this.sessions.attachToMission(input);
  }
}
