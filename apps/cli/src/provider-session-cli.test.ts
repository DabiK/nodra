import { asId } from "@nodra/domain";
import { describe, expect, it } from "vitest";
import { ProviderSessionCli } from "./provider-session-cli.js";
import { I4Cli } from "./i4-cli.js";

describe("ProviderSessionCli", () => {
  it("attaches using the provider external session ID and the stable command context", async () => {
    let received: unknown;
    const cli = new ProviderSessionCli({ execute: async (input: unknown) => {
      received = input;
      return { link: { mode: "read_only" } };
    } } as never);

    await expect(cli.execute({
      command: "provider-session:attach",
      args: ["--provider", "codex", "--session", "thread/external-42", "--mission", "mission/1"],
      context: { commandId: asId("attach/stable"), actor: "user", occurredAt: "2026-08-02T10:00:00.000Z" }
    })).resolves.toEqual({ link: { mode: "read_only" } });
    expect(received).toEqual({
      providerId: "codex", externalSessionId: "thread/external-42", missionId: asId("mission/1"),
      commandId: asId("attach/stable"), actor: "user", occurredAt: "2026-08-02T10:00:00.000Z"
    });
  });

  it("requires each explicit flag", async () => {
    const cli = new ProviderSessionCli({ execute: async () => ({}) } as never);
    await expect(cli.execute({ command: "provider-session:attach", args: ["--provider", "codex"], context: { commandId: asId("attach"), actor: "user", occurredAt: "now" } }))
      .rejects.toMatchObject({ code: "CLI_USAGE_ERROR" });
  });

  it("accepts --command-id through the CLI command-context boundary", async () => {
    let received: { commandId: string; externalSessionId: string } | undefined;
    const cli = new I4Cli([new ProviderSessionCli({ execute: async (input: typeof received) => {
      received = input;
      return { attached: true };
    } } as never)]);

    await expect(cli.execute("provider-session:attach", [
      "--provider", "codex", "--session", "thread/7", "--mission", "mission/7", "--command-id", "attach/retry-7"
    ])).resolves.toEqual({ attached: true });
    expect(received).toMatchObject({ commandId: "attach/retry-7", externalSessionId: "thread/7" });
  });
});
