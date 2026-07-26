import type { Id } from "@nodra/domain";
import type { AgentConfigValues } from "./agent-config-model.js";
import type { AgentConfigRepository } from "./agent-config-repository.js";
import type { CommandContext } from "./command-context.js";

export class UpdateAgentConfig {
  constructor(private readonly configs: AgentConfigRepository) {}

  execute(input: {
    missionId: Id;
    expectedVersion: number;
    values: AgentConfigValues;
    context: CommandContext;
  }) {
    return this.configs.update(input);
  }
}
