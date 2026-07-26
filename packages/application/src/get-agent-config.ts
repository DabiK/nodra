import { DomainError, type Id } from "@nodra/domain";
import type { AgentConfigRepository } from "./agent-config-repository.js";

export class GetAgentConfig {
  constructor(private readonly configs: AgentConfigRepository) {}

  async execute(missionId: Id) {
    const config = await this.configs.get(missionId);
    if (!config) {
      throw new DomainError(`Agent configuration for mission ${missionId} was not found`, "AGENT_CONFIG_REQUIRED");
    }
    return config;
  }
}
