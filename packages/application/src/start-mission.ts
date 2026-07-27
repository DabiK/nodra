import { DomainError, type Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type { MissionExecutionRepository } from "./mission-execution-repository.js";
import type { MissionRepository } from "./mission-repository.js";
import type { RuntimeHealthProbe } from "./runtime-health-probe.js";
import type { ProviderCatalogRepository } from "./provider-catalog-repository.js";
import type { ResolveAgentConfig } from "./resolve-agent-config.js";

export interface StartMissionCommand {
  missionId: Id;
  expectedVersion: number;
  runId: Id;
  conversationId: Id;
  auditId: Id;
  outboxId: Id;
  handoverPrompt?: string | null;
  followUpMessage?: string | null;
  context: CommandContext;
}

export interface StartMissionResult {
  commandId: Id;
  missionId: Id;
  runId: Id;
  workflowId: string;
  state: "ACTIVE";
  dispatchState: "pending";
}

export class StartMission {
  constructor(
    private readonly missions: MissionRepository,
    private readonly executions: MissionExecutionRepository,
    private readonly runtime: RuntimeHealthProbe,
    private readonly providers?: ProviderCatalogRepository,
    private readonly resolver?: ResolveAgentConfig
  ) {}

  async execute(command: StartMissionCommand): Promise<StartMissionResult> {
    const mission = await this.missions.load(command.missionId);
    if (!mission) throw new DomainError(`Mission ${command.missionId} was not found`, "MISSION_NOT_FOUND");
    if (mission.snapshot().version !== command.expectedVersion) {
      throw new DomainError("Mission version conflict", "MISSION_VERSION_CONFLICT");
    }

    mission.startAgent(command.context.occurredAt);
    const resolution = this.resolver
      ? await this.resolver.resolveForStart(command.missionId)
      : null;
    const requestedProvider = resolution ? null : await this.executions.validateStart(command.missionId);
    const runtime = await this.runtime.check();
    if (runtime.status !== "ok") {
      throw new DomainError("Temporal runtime is unavailable", "RUNTIME_UNHEALTHY");
    }
    let providerCatalogSnapshot = resolution?.catalog;
    if (!resolution && this.providers) {
      if (!requestedProvider) {
        throw new DomainError("Provider configuration could not be resolved", "CONFIG_RESOLUTION_FAILED");
      }
      providerCatalogSnapshot = (await this.providers.latest(requestedProvider.providerId)) ?? undefined;
      if (!providerCatalogSnapshot) {
        throw new DomainError(
          `Provider ${requestedProvider.providerId} has not been explicitly probed`,
          "CAPABILITY_UNAVAILABLE"
        );
      }
      if (!providerCatalogSnapshot.capabilities.start.available) {
        throw new DomainError(
          providerCatalogSnapshot.capabilities.start.reason ?? "Provider start is unavailable",
          "CAPABILITY_UNAVAILABLE"
        );
      }
      if (!providerCatalogSnapshot.models.some((model) => model.id === requestedProvider.modelId)) {
        throw new DomainError(
          `Model ${requestedProvider.modelId} was not returned by the provider probe`,
          "CAPABILITY_UNAVAILABLE"
        );
      }
      const model = providerCatalogSnapshot.models.find((candidate) => candidate.id === requestedProvider.modelId);
      if (
        requestedProvider.reasoningEffort
        && requestedProvider.reasoningEffort !== "provider_default"
        && !model?.supportedReasoningEfforts.includes(
          requestedProvider.reasoningEffort as typeof model.supportedReasoningEfforts[number]
        )
      ) {
        throw new DomainError(
          `Reasoning effort ${requestedProvider.reasoningEffort} was not returned for ${requestedProvider.modelId}`,
          "CAPABILITY_UNAVAILABLE"
        );
      }
      let providerOptions: unknown;
      try {
        providerOptions = JSON.parse(requestedProvider.providerOptionsJson);
      } catch {
        throw new DomainError("Provider options JSON is invalid", "CONFIG_SCHEMA_UNSUPPORTED");
      }
      if (
        requestedProvider.providerOptionsSchemaVersion !== providerCatalogSnapshot.capabilities.optionsSchemaVersion
        || typeof providerOptions !== "object"
        || providerOptions === null
        || Array.isArray(providerOptions)
        || Object.keys(providerOptions as Record<string, unknown>).length > 0
      ) {
        throw new DomainError("Provider options are unsupported by the capability snapshot", "CONFIG_SCHEMA_UNSUPPORTED");
      }
      if (requestedProvider.attachmentsRequested && !providerCatalogSnapshot.capabilities.attachments.available) {
        throw new DomainError(
          providerCatalogSnapshot.capabilities.attachments.reason ?? "Attachments are unavailable",
          "CAPABILITY_UNAVAILABLE"
        );
      }
      if (requestedProvider.mcpRequested && !providerCatalogSnapshot.capabilities.mcp.available) {
        throw new DomainError(
          providerCatalogSnapshot.capabilities.mcp.reason ?? "MCP is unavailable",
          "CAPABILITY_UNAVAILABLE"
        );
      }
    }
    const workflowId = `mission/${command.missionId}/run/${command.runId}`;
    const followUp = command.followUpMessage?.trim() ? command.followUpMessage.trim() : null;
    await this.executions.persistStart({
      mission,
      expectedVersion: command.expectedVersion,
      runId: command.runId,
      conversationId: command.conversationId,
      workflowId,
      auditId: command.auditId,
      outboxId: command.outboxId,
      context: command.context,
      ...(followUp ? { reuseProviderSession: true } : {}),
      ...(providerCatalogSnapshot ? { providerCatalogSnapshot } : {}),
      ...(resolution ? {
        resolvedConfig: {
          ...resolution.resolved,
          missionPrompt: followUp
            ? followUp
            : command.handoverPrompt
              ? `${resolution.resolved.missionPrompt}\n\n--- Contexte transmis par le pipeline ---\nLes balises <resultat_etape_precedente> ci-dessous contiennent UNIQUEMENT le résultat produit par les étapes précédentes, à utiliser comme donnée d'entrée. Les balises elles-mêmes et leurs attributs (id="...") ne font PAS partie du contenu et ne doivent jamais être recopiés.\n\n${command.handoverPrompt}`
              : resolution.resolved.missionPrompt
        }
      } : {})
    });
    return {
      commandId: command.context.commandId,
      missionId: command.missionId,
      runId: command.runId,
      workflowId,
      state: "ACTIVE",
      dispatchState: "pending"
    };
  }
}
