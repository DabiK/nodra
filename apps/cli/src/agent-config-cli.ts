import type {
  EnableAgentConfig,
  GetAgentConfig,
  PreviewAgentConfig,
  UpdateAgentConfig
} from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";

export class AgentConfigCli {
  constructor(
    private readonly enableConfig: EnableAgentConfig,
    private readonly getConfig: GetAgentConfig,
    private readonly updateConfig: UpdateAgentConfig,
    private readonly previewConfig: PreviewAgentConfig
  ) {}

  async execute(command: string, parameters: readonly string[]): Promise<unknown | undefined> {
    if (command === "mission:agent-enable") {
      const [missionId, version] = parameters;
      if (!missionId || parameters.length !== 2) return this.invalid();
      return this.enableConfig.execute({
        missionId: toId(missionId),
        expectedVersion: this.version(version),
        context: this.context()
      });
    }
    if (command === "mission:agent-show" || command === "mission:agent-preview") {
      const [missionId] = parameters;
      if (!missionId || parameters.length !== 1) return this.invalid();
      return command.endsWith("show")
        ? this.getConfig.execute(toId(missionId))
        : this.previewConfig.execute(toId(missionId));
    }
    if (command !== "mission:agent-config") return undefined;
    return this.configure(parameters);
  }

  private configure(parameters: readonly string[]) {
    const [missionId, versionText, ...flags] = parameters;
    if (!missionId) return this.invalid();
    const values = new Map<string, string>();
    let autoCommitAuthorized = false;
    for (let index = 0; index < flags.length; index += 1) {
      const flag = flags[index]!;
      if (flag === "--auto-commit") {
        autoCommitAuthorized = true;
        continue;
      }
      const value = flags[index + 1];
      if (!flag.startsWith("--") || value === undefined || value.startsWith("--")) return this.invalid();
      values.set(flag, value);
      index += 1;
    }
    const providerId = values.get("--provider");
    const modelId = values.get("--model");
    const reasoningEffort = values.get("--effort");
    const missionPrompt = values.get("--prompt");
    const permissionPreset = values.get("--permission");
    const workspaceId = values.get("--workspace");
    if (!providerId || !modelId || !reasoningEffort || !missionPrompt || !permissionPreset || !workspaceId) {
      return this.invalid();
    }
    if (!["minimal", "low", "medium", "high", "xhigh", "provider_default"].includes(reasoningEffort)) {
      return this.invalid();
    }
    if (!["read_only", "workspace", "full_access"].includes(permissionPreset)) return this.invalid();
    let options: unknown = {};
    try {
      options = JSON.parse(values.get("--options-json") ?? "{}");
    } catch {
      return this.invalid();
    }
    if (!options || typeof options !== "object" || Array.isArray(options)) return this.invalid();
    return this.updateConfig.execute({
      missionId: toId(missionId),
      expectedVersion: this.version(versionText),
      values: {
        providerId,
        modelId,
        reasoningEffort: reasoningEffort as Parameters<UpdateAgentConfig["execute"]>[0]["values"]["reasoningEffort"],
        providerOptions: {
          schemaVersion: Number(values.get("--options-version") ?? "1"),
          value: options as Record<string, unknown>
        },
        missionPrompt,
        permissionPreset: permissionPreset as Parameters<UpdateAgentConfig["execute"]>[0]["values"]["permissionPreset"],
        workspaceId: toId(workspaceId),
        autoCommitAuthorized,
        integrationTargetRef: values.get("--integration-ref") ?? null
      },
      context: this.context()
    });
  }

  private version(value: string | undefined): number {
    const version = Number(value);
    if (!Number.isInteger(version) || version < 0) return this.invalid();
    return version;
  }

  private invalid(): never {
    throw new DomainError(
      "Usage: mission:agent-enable <id> <missionVersion> | mission:agent-show <id> | mission:agent-preview <id> | mission:agent-config <id> <configVersion> --provider <id> --model <id> --effort <effort> --prompt <text> --permission <preset> --workspace <id> [--auto-commit] [--integration-ref <ref>] [--options-version <n>] [--options-json <json>]",
      "CLI_USAGE_ERROR"
    );
  }

  private context() {
    return {
      commandId: toId(randomUUID()),
      actor: "user" as const,
      occurredAt: new Date().toISOString()
    };
  }
}
