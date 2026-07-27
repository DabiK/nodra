import type { Id, Manager } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type { ProviderCatalogSnapshot } from "./provider-model.js";

export interface PersistManagerStartInput {
  manager: Manager;
  runId: Id;
  conversationId: Id;
  reuseConversationId: Id | null;
  workflowId: string;
  auditId: Id;
  outboxId: Id;
  effectivePrompt: string;
  briefPrompt: string;
  providerCatalogSnapshot?: ProviderCatalogSnapshot;
  context: CommandContext;
}

export interface ManagerStartValidation {
  providerId: string;
  modelId: string;
  reasoningEffort: string | null;
  providerOptionsSchemaVersion: number;
  providerOptionsJson: string;
  workspaceId: string;
  workspacePath: string;
}

export interface ManagerExecutionRepository {
  validateStart(managerId: Id): Promise<ManagerStartValidation>;
  persistStart(input: PersistManagerStartInput): Promise<void>;
}
