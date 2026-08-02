import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import type { ProviderCatalogRepository, ProviderRegistry } from "@nodra/application";
import { PROVIDER_CATALOG, PROVIDER_REGISTRY } from "./tokens.js";

@Injectable()
export class ProviderProbeLifecycle implements OnApplicationBootstrap {
  constructor(
    @Inject(PROVIDER_REGISTRY) private readonly providers: ProviderRegistry,
    @Inject(PROVIDER_CATALOG) private readonly catalog: ProviderCatalogRepository
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const results = await Promise.allSettled(
      this.providers.ids().map(async (providerId) => {
        const result = await this.providers.resolve(providerId).probe();
        await this.catalog.save(result);
        return { providerId, result };
      })
    );
    for (const settled of results) {
      if (settled.status === "fulfilled") {
        const { providerId, result } = settled.value;
        console.log(`[provider-probe] ${providerId}: health=${result.health.status} models=${result.models.length}`);
      } else {
        console.error(`[provider-probe] failed: ${String(settled.reason)}`);
      }
    }
  }
}
