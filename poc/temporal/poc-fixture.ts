import { StartMission, type ProviderCapabilities } from "@nodra/application";
import { asId } from "@nodra/domain";
import type {
  LazyTemporalConnection,
  NodraSqliteDatabase,
  SqliteProviderCatalogRepository
} from "@nodra/adapters";
import { join } from "node:path";
import { workspaces } from "../../packages/adapters/src/sqlite/schema/core.js";
import { missionAgentConfigs, missions } from "../../packages/adapters/src/sqlite/schema/missions.js";
import { SqliteMissionExecutionRepository } from "../../packages/adapters/src/sqlite/sqlite-mission-execution-repository.js";
import { SqliteMissionRepository } from "../../packages/adapters/src/sqlite/sqlite-mission-repository.js";
import type { DeterministicProvider } from "./deterministic-provider.js";

export const POC_OCCURRED_AT = "2026-07-26T10:00:00.000Z";

export const saveDeterministicCatalog = async (
  catalog: SqliteProviderCatalogRepository,
  provider: DeterministicProvider
): Promise<void> => {
  const available = { available: true, reason: null };
  const capabilities: ProviderCapabilities = {
    schemaVersion: 1,
    providerId: provider.providerId,
    version: "i6-2-fixture-v1",
    availability: available,
    authentication: available,
    models: available,
    contract: {
      ...available,
      status: "certified",
      expectedVersion: "i6-2-fixture-v1",
      currentVersion: "i6-2-fixture-v1",
      action: null
    },
    start: available,
    events: available,
    cancel: available,
    resume: available,
    steer: { ...available, mode: "immediate" },
    usage: { available: false, reason: "fixture_has_no_usage", kind: "none" },
    attachments: { available: false, reason: "fixture_only" },
    mcp: { available: false, reason: "fixture_only" },
    permissionInterception: available,
    optionsSchemaVersion: 1
  };
  await catalog.save({
    providerId: provider.providerId,
    adapterVersion: "i6-2-fixture-v1",
    binaryVersion: "deterministic-no-process",
    authenticated: true,
    authKind: "fixture",
    health: { status: "ready", reason: null, actionRequired: null },
    capabilities,
    models: [{
      id: "fixture-model",
      displayName: "Fixture Model",
      description: "No network, no model and no token consumption",
      hidden: false,
      isDefault: true,
      supportedReasoningEfforts: ["low"],
      defaultReasoningEffort: "low"
    }],
    probedAt: POC_OCCURRED_AT
  });
};

export const seedPocMission = (
  database: NodraSqliteDatabase,
  workspaceRoot: string,
  providerId: string,
  missionId: string
): void => {
  const workspaceId = `workspace-${missionId}`;
  database.orm.insert(workspaces).values({
    id: workspaceId,
    projectId: null,
    kind: "scratch",
    path: join(workspaceRoot, missionId),
    state: "ready",
    createdAt: POC_OCCURRED_AT
  }).run();
  database.orm.insert(missions).values({
    id: missionId,
    projectId: null,
    title: `I6.2 ${missionId}`,
    executionKind: "agent",
    state: "READY",
    version: 1,
    createdAt: POC_OCCURRED_AT,
    updatedAt: POC_OCCURRED_AT
  }).run();
  database.orm.insert(missionAgentConfigs).values({
    missionId,
    providerId,
    modelId: "fixture-model",
    reasoningEffort: "low",
    providerOptionsJson: "{}",
    missionPrompt: "deterministic fixture only",
    permissionPreset: "read_only",
    workspaceId,
    updatedAt: POC_OCCURRED_AT
  }).run();
};

export const persistPocStart = async (
  database: NodraSqliteDatabase,
  runtime: LazyTemporalConnection,
  catalog: SqliteProviderCatalogRepository | undefined,
  missionId: string
): Promise<void> => {
  const missions = new SqliteMissionRepository(database);
  const executions = new SqliteMissionExecutionRepository(database);
  const startMission = catalog
    ? new StartMission(missions, executions, runtime, catalog)
    : new StartMission(missions, executions, runtime);
  await startMission.execute({
    missionId: asId(missionId),
    expectedVersion: 1,
    runId: asId(`run-${missionId}`),
    conversationId: asId(`conversation-${missionId}`),
    auditId: asId(`audit-${missionId}`),
    outboxId: asId(`outbox-${missionId}`),
    context: {
      commandId: asId(`command-${missionId}`),
      actor: "user",
      occurredAt: POC_OCCURRED_AT
    }
  });
};
