import type { Id, Mission } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type {
  AgentConfig,
  AgentConfigResolutionSource,
  AgentConfigValues
} from "./agent-config-model.js";

export interface EnableAgentConfigInput {
  mission: Mission;
  expectedMissionVersion: number;
  context: CommandContext;
}

export interface UpdateAgentConfigInput {
  missionId: Id;
  expectedVersion: number;
  values: AgentConfigValues;
  context: CommandContext;
}

export interface AgentConfigRepository {
  enable(input: EnableAgentConfigInput): Promise<AgentConfig>;
  get(missionId: Id): Promise<AgentConfig | null>;
  update(input: UpdateAgentConfigInput): Promise<AgentConfig>;
  resolutionSource(missionId: Id): Promise<AgentConfigResolutionSource | null>;
}
