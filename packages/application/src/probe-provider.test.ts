import { describe, expect, it, vi } from "vitest";
import { ProbeProvider } from "./probe-provider.js";
import type { ProviderCatalogRepository } from "./provider-catalog-repository.js";
import type { ProviderPort } from "./provider-port.js";
import { ProviderRegistry } from "./provider-registry.js";

describe("ProbeProvider", () => {
  it("never launches the real provider unless the caller explicitly opts in", async () => {
    const probe = vi.fn();
    const provider = { providerId: "fixture", probe } as unknown as ProviderPort;
    const catalog = { save: vi.fn() } as unknown as ProviderCatalogRepository;

    await expect(new ProbeProvider(new ProviderRegistry([provider]), catalog).execute({
      providerId: "fixture",
      optIn: false
    })).rejects.toMatchObject({ code: "PROVIDER_PROBE_OPT_IN_REQUIRED" });
    expect(probe).not.toHaveBeenCalled();
  });
});
