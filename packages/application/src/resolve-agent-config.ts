import { DomainError, type Id } from "@nodra/domain";
import type {
  AgentConfigBlockingError,
  AgentConfigPreview,
  ResolvedAgentConfig
} from "./agent-config-model.js";
import type { AgentConfigRepository } from "./agent-config-repository.js";
import type { ProviderCatalogRepository } from "./provider-catalog-repository.js";

export class ResolveAgentConfig {
  constructor(
    private readonly configs: AgentConfigRepository,
    private readonly providers: ProviderCatalogRepository
  ) {}

  async preview(missionId: Id): Promise<AgentConfigPreview> {
    const source = await this.configs.resolutionSource(missionId);
    if (!source) {
      throw new DomainError(`Agent configuration for mission ${missionId} was not found`, "AGENT_CONFIG_REQUIRED");
    }
    const errors: AgentConfigBlockingError[] = [];
    const config = source.config;
    const required = [
      ["providerId", config.providerId],
      ["modelId", config.modelId],
      ["reasoningEffort", config.reasoningEffort],
      ["missionPrompt", config.missionPrompt.trim() || null],
      ["permissionPreset", config.permissionPreset],
      ["workspaceId", config.workspaceId]
    ] as const;
    for (const [field, value] of required) {
      if (value === null) {
        errors.push({ code: "AGENT_CONFIG_REQUIRED", field, reason: `${field} is required` });
      }
    }
    const catalog = config.providerId ? await this.providers.latest(config.providerId) : null;
    if (config.providerId && !catalog) {
      errors.push({
        code: "CAPABILITY_UNAVAILABLE",
        field: "providerId",
        reason: `Provider ${config.providerId} has no persisted catalog snapshot`
      });
    }
    if (catalog && !catalog.capabilities.start.available) {
      errors.push({
        code: "CAPABILITY_UNAVAILABLE",
        field: "providerId",
        reason: catalog.capabilities.start.reason ?? "Provider start is unavailable"
      });
    }
    const model = catalog?.models.find((candidate) => candidate.id === config.modelId);
    if (catalog && config.modelId && !model) {
      errors.push({
        code: "CAPABILITY_UNAVAILABLE",
        field: "modelId",
        reason: `Model ${config.modelId} is absent from the latest provider snapshot`
      });
    }
    if (
      model
      && config.reasoningEffort
      && !model.supportedReasoningEfforts.includes(config.reasoningEffort)
    ) {
      errors.push({
        code: "CAPABILITY_UNAVAILABLE",
        field: "reasoningEffort",
        reason: `Reasoning effort ${config.reasoningEffort} is absent from the latest model snapshot`
      });
    }
    if (
      catalog
      && config.providerOptions.schemaVersion !== catalog.capabilities.optionsSchemaVersion
    ) {
      errors.push({
        code: "CONFIG_SCHEMA_UNSUPPORTED",
        field: "providerOptions",
        reason: "Provider options schema version does not match the latest provider snapshot"
      });
    }
    if (Object.keys(config.providerOptions.value).length > 0) {
      errors.push({
        code: "CONFIG_SCHEMA_UNSUPPORTED",
        field: "providerOptions",
        reason: "Opaque provider options are not proven by the current provider capability snapshot"
      });
    }
    if (source.attachmentsRequested && catalog && !catalog.capabilities.attachments.available) {
      errors.push({
        code: "CAPABILITY_UNAVAILABLE",
        field: "attachments",
        reason: catalog.capabilities.attachments.reason ?? "Attachments are unavailable"
      });
    }
    if (source.mcpRequested && catalog && !catalog.capabilities.mcp.available) {
      errors.push({
        code: "CAPABILITY_UNAVAILABLE",
        field: "mcp",
        reason: catalog.capabilities.mcp.reason ?? "MCP is unavailable"
      });
    }
    if (!source.workspace) {
      if (config.workspaceId) {
        errors.push({
          code: "AGENT_CONFIG_REQUIRED",
          field: "workspaceId",
          reason: `Workspace ${config.workspaceId} was not found`
        });
      }
    } else if (source.workspace.state !== "ready") {
      errors.push({
        code: "WORKSPACE_STATE_CONFLICT",
        field: "workspaceId",
        reason: `Workspace ${source.workspace.id} is ${source.workspace.state}, expected ready`
      });
    }
    const resolved = errors.length === 0
      ? {
          configVersion: config.version,
          providerId: config.providerId!,
          modelId: config.modelId!,
          reasoningEffort: config.reasoningEffort!,
          providerOptions: config.providerOptions,
          missionPrompt: config.missionPrompt,
          permissionPreset: config.permissionPreset!,
          workspaceId: config.workspaceId!,
          cwd: source.workspace!.path,
          autoCommitAuthorized: config.autoCommitAuthorized,
          integrationTargetRef: config.integrationTargetRef,
          catalogVersion: catalog!.catalogVersion
        } satisfies ResolvedAgentConfig
      : null;
    return {
      requested: config,
      resolved,
      provenance: {
        providerId: "mission",
        modelId: "mission",
        reasoningEffort: "mission",
        providerOptions: "mission",
        missionPrompt: "mission",
        permissionPreset: "mission",
        workspaceId: "mission",
        autoCommitAuthorized: "mission",
        integrationTargetRef: "mission"
      },
      capabilities: catalog?.capabilities ?? null,
      blockingErrors: errors,
      catalog
    };
  }

  async resolveForStart(missionId: Id): Promise<{
    resolved: ResolvedAgentConfig;
    catalog: NonNullable<AgentConfigPreview["catalog"]>;
  }> {
    const preview = await this.preview(missionId);
    const first = preview.blockingErrors[0];
    if (first || !preview.resolved || !preview.catalog) {
      throw new DomainError(
        first?.reason ?? "Agent configuration could not be resolved",
        first?.code ?? "CONFIG_RESOLUTION_FAILED"
      );
    }
    return { resolved: preview.resolved, catalog: preview.catalog };
  }
}
