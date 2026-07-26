import type { ProviderCatalogRepository } from "./provider-catalog-repository.js";
import type {
  ProviderComponentHealth,
  ProviderHealthProbe
} from "./provider-health-probe.js";

export class CatalogProviderHealthProbe implements ProviderHealthProbe {
  constructor(
    private readonly catalog: ProviderCatalogRepository,
    private readonly providerId: string
  ) {}

  async check(): Promise<ProviderComponentHealth> {
    const snapshot = await this.catalog.latest(this.providerId);
    if (!snapshot) {
      return {
        providerId: this.providerId,
        status: "unconfigured",
        reason: "no_explicit_probe",
        action: null
      };
    }
    return {
      providerId: snapshot.providerId,
      status: snapshot.health.status === "ready" ? "ok" : "degraded",
      reason: snapshot.health.reason,
      action: snapshot.health.actionRequired
    };
  }
}
