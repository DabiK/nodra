import { describe, expect, it, vi } from "vitest";
import { I6Cli } from "./i6-cli.js";

describe("I6Cli", () => {
  it("requires the visible allow-process flag before invoking the real provider probe", async () => {
    const probe = { execute: vi.fn() };
    const cli = new I6Cli(
      { execute: vi.fn() } as never,
      probe as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never
    );

    await expect(cli.execute("provider:probe", ["codex"])).resolves.toBeUndefined();
    expect(probe.execute).not.toHaveBeenCalled();
    await cli.execute("provider:probe", ["codex", "--allow-process"]);
    expect(probe.execute).toHaveBeenCalledWith({ providerId: "codex", optIn: true });
  });
});
