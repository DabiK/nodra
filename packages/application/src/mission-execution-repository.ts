import type { Id, Mission } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type { ProviderCatalogSnapshot } from "./provider-model.js";
import type { ResolvedAgentConfig } from "./agent-config-model.js";

export interface PersistMissionStartInput {
  mission: Mission;
  expectedVersion: number;
  runId: Id;
  conversationId: Id;
  workflowId: string;
  auditId: Id;
  outboxId: Id;
  context: CommandContext;
  providerCatalogSnapshot?: ProviderCatalogSnapshot;
  resolvedConfig?: ResolvedAgentConfig;
  reuseProviderSession?: boolean;
}

export interface MissionExecutionRepository {
  validateStart(missionId: Id): Promise<void | {
    providerId: string;
    modelId: string;
    reasoningEffort: string | null;
    providerOptionsSchemaVersion: number;
    providerOptionsJson: string;
    attachmentsRequested: boolean;
    mcpRequested: boolean;
  }>;
  persistStart(input: PersistMissionStartInput): Promise<void>;
}
