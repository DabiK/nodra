import { describe, expect, it, vi } from "vitest";
import { ProbeProvider } from "./probe-provider.js";
import type { ProviderCatalogRepository } from "./provider-catalog-repository.js";
import type { ProviderPort } from "./provider-port.js";

describe("ProbeProvider", () => {
  it("never launches the real provider unless the caller explicitly opts in", async () => {
    const probe = vi.fn();
    const provider = { providerId: "codex", probe } as unknown as ProviderPort;
    const catalog = { save: vi.fn() } as unknown as ProviderCatalogRepository;

    await expect(new ProbeProvider(provider, catalog).execute({
      providerId: "codex",
      optIn: false
    })).rejects.toMatchObject({ code: "PROVIDER_PROBE_OPT_IN_REQUIRED" });
    expect(probe).not.toHaveBeenCalled();
  });
});
