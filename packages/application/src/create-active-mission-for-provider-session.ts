import { realpath } from "node:fs/promises";
import { asId, DomainError } from "@nodra/domain";
import { executeProviderSessionSync } from "./map-provider-session-sync-error.js";
import { requireProviderSessionCommandId } from "./provider-session-command.js";
import type {
  CreateReadyAgentMissionAndAttachInput,
  CreatedProviderSessionMissionResult
} from "./provider-session-model.js";
import type { ProviderSessionRepository } from "./provider-session-repository.js";
import type { ProviderSessionSyncRegistry } from "./provider-session-sync-registry.js";

export interface CreateActiveMissionForProviderSessionInput {
  providerSessionId: CreateReadyAgentMissionAndAttachInput["providerSessionId"];
  commandId: CreateReadyAgentMissionAndAttachInput["commandId"];
  actor: CreateReadyAgentMissionAndAttachInput["actor"];
  occurredAt: string;
  title?: string;
  projectId?: CreateReadyAgentMissionAndAttachInput["projectId"];
}

export class CreateActiveMissionForProviderSession {
  constructor(
    private readonly providers: ProviderSessionSyncRegistry,
    private readonly sessions: ProviderSessionRepository
  ) {}

  async execute(
    input: CreateActiveMissionForProviderSessionInput
  ): Promise<CreatedProviderSessionMissionResult> {
    requireProviderSessionCommandId(input.commandId);
    const identity = await this.sessions.load(input.providerSessionId);
    if (!identity) throw new DomainError(`Provider session ${input.providerSessionId} was not found`, "PROVIDER_SESSION_NOT_FOUND");
    if (identity.providerId !== "codex") {
      throw new DomainError(`Provider session ${input.providerSessionId} is not a Codex session`, "CAPABILITY_UNAVAILABLE");
    }
    const provider = this.providers.resolve(identity.providerId);
    const snapshot = await executeProviderSessionSync(() => provider.readSession({
      providerId: identity.providerId,
      externalSessionId: identity.externalSessionRef
    }));
    if (snapshot.session.ref.providerId !== identity.providerId
      || snapshot.session.ref.externalSessionId !== identity.externalSessionRef) {
      throw new DomainError("The provider returned a snapshot for a different session", "PROVIDER_SESSION_PROTOCOL_INCOMPATIBLE");
    }
    const cwd = await this.canonicalCwd(snapshot.session.cwd);
    const requestedTitle = input.title?.trim() || null;
    const title = requestedTitle ?? snapshot.session.title?.trim() ?? `Codex session ${identity.externalSessionRef}`;
    const missionPrompt = snapshot.items.find((item) => item.role === "user" && Boolean(item.text?.trim()))?.text?.trim() ?? title;
    const { projectId, ...command } = input;
    return this.sessions.createReadyAgentMissionAndAttach({
      ...command,
      ...(projectId === undefined ? {} : { projectId }),
      title,
      requestedTitle,
      cwd,
      missionPrompt,
      missionId: asId(`mission/provider-session/${input.commandId}`)
    });
  }

  private async canonicalCwd(cwd: string | null): Promise<string> {
    if (!cwd?.trim()) throw new DomainError("The Codex session has no working directory", "WORKSPACE_CWD_REQUIRED");
    try {
      return await realpath(cwd);
    } catch {
      throw new DomainError(`The Codex session working directory does not exist: ${cwd}`, "WORKSPACE_CWD_UNAVAILABLE");
    }
  }
}
