import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DomainError, type SmokeProvider } from "@nodra/application";

const usage =
  "Usage: nodra provider:smoke <providerId> --allow-turn --model <modelId> [--effort <effort>]";

export class ProviderSmokeCli {
  constructor(
    private readonly smoke: SmokeProvider,
    private readonly dataRoot: string
  ) {}

  async execute(command: string, parameters: readonly string[]): Promise<unknown | undefined> {
    if (command !== "provider:smoke") return undefined;
    const parsed = this.parse(parameters);
    if (!parsed.allowTurn) {
      throw new DomainError(
        "Provider smoke creates one real thread and turn; pass --allow-turn explicitly",
        "PROVIDER_SMOKE_OPT_IN_REQUIRED"
      );
    }
    const root = resolve(this.dataRoot);
    await mkdir(root, { recursive: true });
    const cwd = await mkdtemp(join(root, "provider-smoke-"));
    try {
      return await this.smoke.execute({
        providerId: parsed.providerId,
        modelId: parsed.modelId,
        ...(parsed.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: parsed.reasoningEffort }),
        cwd,
        allowTurn: true
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }

  private parse(parameters: readonly string[]): {
    providerId: string;
    modelId: string;
    reasoningEffort?: string;
    allowTurn: boolean;
  } {
    if (!parameters[0]) {
      throw new DomainError(usage, "CLI_USAGE_ERROR");
    }
    const providerId = parameters[0];
    let modelId: string | undefined;
    let reasoningEffort: string | undefined;
    let allowTurn = false;
    for (let index = 1; index < parameters.length; index += 1) {
      const value = parameters[index];
      if (value === "--allow-turn" && !allowTurn) {
        allowTurn = true;
        continue;
      }
      if (value === "--model" && modelId === undefined && parameters[index + 1]) {
        modelId = parameters[index + 1];
        index += 1;
        continue;
      }
      if (value === "--effort" && reasoningEffort === undefined && parameters[index + 1]) {
        reasoningEffort = parameters[index + 1];
        index += 1;
        continue;
      }
      throw new DomainError(usage, "CLI_USAGE_ERROR");
    }
    if (!modelId) throw new DomainError(usage, "CLI_USAGE_ERROR");
    return {
      providerId,
      modelId,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      allowTurn
    };
  }
}
