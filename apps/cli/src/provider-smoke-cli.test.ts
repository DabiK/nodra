import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ProviderSmokeCli } from "./provider-smoke-cli.js";

describe("ProviderSmokeCli", () => {
  it("parses the explicit model, effort and opt-in in any flag order", async () => {
    const root = await mkdtemp(join(tmpdir(), "nodra-smoke-cli-"));
    let observedCwd = "";
    const smoke = {
      execute: vi.fn(async (input) => {
        observedCwd = input.cwd;
        await expect(access(input.cwd)).resolves.toBeUndefined();
        return { terminalState: "SUCCEEDED" };
      })
    };
    const cli = new ProviderSmokeCli(smoke as never, root);

    await expect(cli.execute("provider:smoke", [
      "codex",
      "--effort",
      "low",
      "--model",
      "gpt-5.4-mini",
      "--allow-turn"
    ])).resolves.toEqual({ terminalState: "SUCCEEDED" });
    expect(smoke.execute).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "codex",
      modelId: "gpt-5.4-mini",
      reasoningEffort: "low",
      allowTurn: true,
      cwd: expect.stringMatching(/provider-smoke-/)
    }));
    await expect(access(observedCwd)).rejects.toBeDefined();
  });

  it("refuses the recognized smoke command before any turn when --allow-turn is absent", async () => {
    const smoke = { execute: vi.fn() };
    const cli = new ProviderSmokeCli(smoke as never, tmpdir());
    await expect(cli.execute("provider:smoke", [
      "codex",
      "--model",
      "gpt-5.4-mini"
    ])).rejects.toMatchObject({ code: "PROVIDER_SMOKE_OPT_IN_REQUIRED" });
    expect(smoke.execute).not.toHaveBeenCalled();
  });

  it("rejects incomplete, duplicate and unknown flags as CLI usage errors", async () => {
    const cli = new ProviderSmokeCli({ execute: vi.fn() } as never, tmpdir());
    await expect(cli.execute("provider:smoke", ["codex", "--allow-turn"]))
      .rejects.toMatchObject({ code: "CLI_USAGE_ERROR" });
    await expect(cli.execute("provider:smoke", [
      "codex",
      "--allow-turn",
      "--model",
      "model",
      "--model",
      "other"
    ])).rejects.toMatchObject({ code: "CLI_USAGE_ERROR" });
  });
});
