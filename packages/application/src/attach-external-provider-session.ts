import { DomainError, type Id } from "@nodra/domain";
import { executeProviderSessionSync } from "./map-provider-session-sync-error.js";
import { requireProviderSessionCommandId } from "./provider-session-command.js";
import type { ProviderSessionIdGenerator } from "./provider-session-id-generator.js";
import type { ProviderSessionAttachmentResult } from "./provider-session-model.js";
import type { ProviderSessionRepository } from "./provider-session-repository.js";
import type { ProviderSessionSyncRegistry } from "./provider-session-sync-registry.js";

export interface AttachExternalProviderSessionInput {
  providerId: string;
  externalSessionId: string;
  missionId: Id;
  commandId: Id;
  actor: "user" | "manager";
  occurredAt: string;
}

export class AttachExternalProviderSession {
  constructor(
    private readonly providers: ProviderSessionSyncRegistry,
    private readonly sessions: ProviderSessionRepository,
    private readonly ids: ProviderSessionIdGenerator
  ) {}

  async execute(input: AttachExternalProviderSessionInput): Promise<ProviderSessionAttachmentResult> {
    requireProviderSessionCommandId(input.commandId);
    const providerId = input.providerId.trim();
    const externalSessionId = input.externalSessionId.trim();
    if (!providerId) throw new DomainError("A provider identifier is required", "PROVIDER_ID_REQUIRED");
    if (!externalSessionId) throw new DomainError("An external session identifier is required", "EXTERNAL_SESSION_REF_REQUIRED");
    const provider = this.providers.resolve(providerId);
    const snapshot = await executeProviderSessionSync(() => provider.readSession({ providerId, externalSessionId }));
    if (snapshot.session.ref.providerId !== providerId || snapshot.session.ref.externalSessionId !== externalSessionId) {
      throw new DomainError("The provider returned a snapshot for a different session", "PROVIDER_SESSION_PROTOCOL_INCOMPATIBLE");
    }
    const session = await this.sessions.observe({
      id: this.ids.next(),
      providerId,
      externalSessionRef: externalSessionId,
      observedAt: snapshot.session.receivedAt
    });
    return this.sessions.attachToMission({
      providerSessionId: session.id,
      missionId: input.missionId,
      commandId: input.commandId,
      actor: input.actor,
      occurredAt: input.occurredAt
    });
  }
}
