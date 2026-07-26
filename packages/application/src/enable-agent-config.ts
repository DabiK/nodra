import { DomainError, type Id } from "@nodra/domain";
import type { AgentConfig } from "./agent-config-model.js";
import type { AgentConfigRepository } from "./agent-config-repository.js";
import type { CommandContext } from "./command-context.js";
import type { MissionRepository } from "./mission-repository.js";

export class EnableAgentConfig {
  constructor(
    private readonly missions: MissionRepository,
    private readonly configs: AgentConfigRepository
  ) {}

  async execute(input: {
    missionId: Id;
    expectedVersion: number;
    context: CommandContext;
  }): Promise<AgentConfig> {
    const mission = await this.missions.load(input.missionId);
    if (!mission) throw new DomainError(`Mission ${input.missionId} was not found`, "MISSION_NOT_FOUND");
    if (mission.snapshot().version !== input.expectedVersion) {
      throw new DomainError("Mission version conflict", "MISSION_VERSION_CONFLICT");
    }
    mission.enableAgent(input.context.occurredAt);
    return this.configs.enable({
      mission,
      expectedMissionVersion: input.expectedVersion,
      context: input.context
    });
  }
}
