import { Body, Controller, Get, HttpCode, Inject, Param, Post } from "@nestjs/common";
import type { GetProviderStatus, ProbeProvider, ProviderCatalogRepository, ProviderPermissionPreset, ProviderReasoningEffort, ProviderRegistry } from "@nodra/application";
import { GET_PROVIDER_STATUS, PROBE_PROVIDER, PROVIDER_CATALOG, PROVIDER_REGISTRY } from "./tokens.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { ProviderProbeDto } from "./dto/provider-probe.dto.js";

@Controller("api/providers")
export class ProviderController {
  constructor(
    @Inject(GET_PROVIDER_STATUS) private readonly status: GetProviderStatus,
    @Inject(PROBE_PROVIDER) private readonly probeProvider: ProbeProvider,
    @Inject(PROVIDER_REGISTRY) private readonly registry: ProviderRegistry,
    @Inject(PROVIDER_CATALOG) private readonly catalog: ProviderCatalogRepository
  ) {}

  @Get("capabilities")
  capabilities() {
    return this.status.execute("codex");
  }

  @Get(":providerId/health")
  health(@Param("providerId") providerId: string) {
    return this.status.execute(providerId);
  }

  @Get("options")
  async options() {
    const providerIds = this.registry.ids();
    const providers = await Promise.all(providerIds.map(async (providerId) => {
      const snapshot = await this.catalog.latest(providerId);
      return {
        id: providerId,
        label: this.label(providerId),
        status: snapshot?.health.status ?? "not_probed",
        reason: snapshot?.health.reason ?? "Run a provider probe to load models",
        models: snapshot?.models
          .map((model) => ({
            id: model.id,
            label: model.displayName,
            description: model.description,
            hidden: model.hidden,
            isDefault: model.isDefault,
            supportedReasoningEfforts: model.supportedReasoningEfforts,
            defaultReasoningEffort: model.defaultReasoningEffort
          })) ?? []
      };
    }));
    const defaultProvider = providers.find((provider) => provider.models.length > 0)?.id ?? providerIds[0] ?? "codex";
    return {
      providers,
      reasoningEfforts: ["provider_default", "minimal", "low", "medium", "high", "xhigh"] satisfies ProviderReasoningEffort[],
      permissionPresets: ["read_only", "workspace", "full_access"] satisfies ProviderPermissionPreset[],
      defaults: {
        providerId: defaultProvider,
        modelId: providers.find((provider) => provider.id === defaultProvider)?.models.find((model) => model.isDefault)?.id
          ?? providers.find((provider) => provider.id === defaultProvider)?.models[0]?.id
          ?? "default",
        reasoningEffort: "provider_default" satisfies ProviderReasoningEffort,
        permissionPreset: "workspace" satisfies ProviderPermissionPreset,
        providerOptions: { schemaVersion: 1, value: {} }
      }
    };
  }

  @Post(":providerId/probe")
  @HttpCode(200)
  probe(@Param("providerId") providerId: string, @Body() body: ProviderProbeDto) {
    return this.probeProvider.execute({ providerId, optIn: body.optIn });
  }

  private label(providerId: string) {
    return providerId === "opencode"
      ? "OpenCode"
      : providerId === "codex"
        ? "Codex"
        : providerId;
  }
}
