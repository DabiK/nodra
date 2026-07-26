import { describe, expect, it, vi } from "vitest";
import type { ProviderCatalogRepository } from "./provider-catalog-repository.js";
import type { ProviderCatalogSnapshot } from "./provider-model.js";
import { CatalogProviderHealthProbe } from "./catalog-provider-health-probe.js";

describe("CatalogProviderHealthProbe", () => {
  it("reports an unconfigured provider without starting a process", async () => {
    const catalog = {
      latest: vi.fn(async () => null)
    } as unknown as ProviderCatalogRepository;
    await expect(new CatalogProviderHealthProbe(catalog, "provider-a").check()).resolves.toEqual({
      providerId: "provider-a",
      status: "unconfigured",
      reason: "no_explicit_probe",
      action: null
    });
    expect(catalog.latest).toHaveBeenCalledOnce();
  });

  it("projects a compatible unverified snapshot as degraded and update required", async () => {
    const catalog = {
      latest: vi.fn(async () => ({
        providerId: "provider-a",
        health: {
          status: "degraded",
          reason: "provider_version_not_certified",
          actionRequired: "update_required"
        }
      } as ProviderCatalogSnapshot))
    } as unknown as ProviderCatalogRepository;
    await expect(new CatalogProviderHealthProbe(catalog, "provider-a").check()).resolves.toEqual({
      providerId: "provider-a",
      status: "degraded",
      reason: "provider_version_not_certified",
      action: "update_required"
    });
  });
});
