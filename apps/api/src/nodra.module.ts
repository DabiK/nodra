import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import {
  ContentAddressedBlobStore,
  CodexProviderAdapter,
  OpenCodeProviderAdapter,
  LazyTemporalConnection,
  LazyTemporalWorkflowAdapter,
  LocalCommandObservationAdapter,
  LocalWorkspaceAdapter,
  migrateDatabase,
  NodraSqliteDatabase,
  ReadOnlyGitObservationAdapter,
  SqliteApprovalRepository,
  SqliteAgentConfigRepository,
  SqliteDeliveryRepository,
  SqliteEvidenceRepository,
  SqliteGateRepository,
  SqliteHealthProbe,
  SqliteMissionReadModel,
  SqliteMissionRepository,
  SqliteMissionExecutionRepository,
  SqlitePipelineRepository,
  SqliteProviderCatalogRepository,
  SqliteRunControlRepository,
  SqliteConfirmationRepository,
  SqliteWorkspaceRepository,
  SqliteWorkspaceDeletionReservation,
  SqliteWorkflowOutboxStore,
  SqliteWorkflowReconciliationStore
} from "@nodra/adapters";
import {
  ChangeMissionState,
  AdvancePipeline,
  CancelRun,
  CatalogProviderHealthProbe,
  CommitWorkspace,
  CollectEvidence,
  CreateMission,
  CreatePipeline,
  CreateWorkspace,
  DeleteWorkspace,
  DispatchWorkflowOutbox,
  EnableAgentConfig,
  GetAgentConfig,
  GetHealth,
  GetProviderStatus,
  GetRelay,
  ListMissions,
  ManageApprovals,
  ManageConfirmations,
  ManageDelivery,
  ManageGates,
  ReadEvidence,
  ReadWorkspace,
  ResumeRun,
  ReconcileWorkflows,
  ShowPipeline,
  ShowPipelineRun,
  ShowMission,
  SnapshotWorkspace,
  StartMission,
  StartPipeline,
  SteerRun,
  ProbeProvider,
  ProviderRegistry,
  PreviewAgentConfig,
  ResolveAgentConfig,
  StructuredGateEvaluatorRegistry,
  IntegrateWorkspace,
  RestoreWorkspace,
  UpdateAgentConfig
} from "@nodra/application";
import { ApprovalController } from "./approval.controller.js";
import { BusinessErrorFilter } from "./business-error.filter.js";
import { DatabaseLifecycle } from "./database-lifecycle.js";
import { DeliveryController } from "./delivery.controller.js";
import { ConfirmationController } from "./confirmation.controller.js";
import { EvidenceController } from "./evidence.controller.js";
import { GateController } from "./gate.controller.js";
import { HealthController } from "./health.controller.js";
import { MissionController } from "./mission.controller.js";
import { RelayController } from "./relay.controller.js";
import { RuntimeController } from "./runtime.controller.js";
import { RuntimeLifecycle } from "./runtime-lifecycle.js";
import { WorkspaceController } from "./workspace.controller.js";
import { ProviderController } from "./provider.controller.js";
import { PipelineController } from "./pipeline.controller.js";
import { RunController } from "./run.controller.js";
import {
  AGENT_CONFIG_REPOSITORY,
  ADVANCE_PIPELINE,
  CANCEL_RUN,
  CHANGE_MISSION_STATE,
  COLLECT_EVIDENCE,
  COMMIT_WORKSPACE,
  CREATE_WORKSPACE,
  CREATE_MISSION,
  CREATE_PIPELINE,
  DATABASE,
  DELETE_WORKSPACE,
  DISPATCH_WORKFLOW_OUTBOX,
  GET_HEALTH,
  GET_PROVIDER_STATUS,
  GET_RELAY,
  INTEGRATE_WORKSPACE,
  LIST_MISSIONS,
  MANAGE_APPROVALS,
  MANAGE_CONFIRMATIONS,
  MANAGE_DELIVERY,
  MANAGE_GATES,
  PROBE_PROVIDER,
  PROVIDER_CATALOG,
  PROVIDER_REGISTRY,
  READ_EVIDENCE,
  READ_WORKSPACE,
  RECONCILE_WORKFLOWS,
  RESTORE_WORKSPACE,
  RESUME_RUN,
  SHOW_MISSION,
  SHOW_PIPELINE,
  SHOW_PIPELINE_RUN,
  SNAPSHOT_WORKSPACE,
  START_MISSION,
  START_PIPELINE,
  STEER_RUN,
  TEMPORAL_CONNECTION,
  WORKSPACE_PORT,
  ENABLE_AGENT_CONFIG,
  GET_AGENT_CONFIG,
  PREVIEW_AGENT_CONFIG,
  RESOLVE_AGENT_CONFIG,
  UPDATE_AGENT_CONFIG
} from "./tokens.js";

export interface NodraModuleOptions {
  databaseFile: string;
  migrationsDirectory: string;
  temporalAddress?: string;
  temporalNamespace?: string;
  dataRoot?: string;
  opencodeBaseUrl?: string;
}

@Module({})
export class NodraModule {
  static register(options: NodraModuleOptions): DynamicModule {
    return {
      module: NodraModule,
      controllers: [HealthController, MissionController, RelayController, RuntimeController, EvidenceController, GateController, ApprovalController, DeliveryController, ConfirmationController, WorkspaceController, ProviderController, RunController, PipelineController],
      providers: [
        {
          provide: DATABASE,
          useFactory: async () => {
            await mkdir(dirname(options.databaseFile), { recursive: true });
            const database = NodraSqliteDatabase.open(options.databaseFile);
            try {
              await migrateDatabase(database, options.migrationsDirectory);
              return database;
            } catch (error) {
              database.close();
              throw error;
            }
          }
        },
        {
          provide: WORKSPACE_PORT,
          useFactory: async () => {
            const adapter = new LocalWorkspaceAdapter(`${options.dataRoot ?? dirname(options.databaseFile)}/workspaces`);
            await adapter.initialize();
            return adapter;
          }
        },
        {
          provide: MANAGE_CONFIRMATIONS,
          inject: [DATABASE, WORKSPACE_PORT],
          useFactory: (database: NodraSqliteDatabase, workspace: LocalWorkspaceAdapter) =>
            new ManageConfirmations(new SqliteConfirmationRepository(database), workspace)
        },
        {
          provide: CREATE_WORKSPACE,
          inject: [DATABASE, WORKSPACE_PORT],
          useFactory: (database: NodraSqliteDatabase, workspace: LocalWorkspaceAdapter) =>
            new CreateWorkspace(new SqliteWorkspaceRepository(database), workspace)
        },
        {
          provide: READ_WORKSPACE,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) =>
            new ReadWorkspace(new SqliteWorkspaceRepository(database))
        },
        {
          provide: SNAPSHOT_WORKSPACE,
          inject: [DATABASE, WORKSPACE_PORT],
          useFactory: (database: NodraSqliteDatabase, workspace: LocalWorkspaceAdapter) =>
            new SnapshotWorkspace(new SqliteWorkspaceRepository(database), workspace)
        },
        {
          provide: COMMIT_WORKSPACE,
          inject: [DATABASE, WORKSPACE_PORT, MANAGE_CONFIRMATIONS],
          useFactory: (
            database: NodraSqliteDatabase,
            workspace: LocalWorkspaceAdapter,
            confirmations: ManageConfirmations
          ) => new CommitWorkspace(new SqliteWorkspaceRepository(database), workspace, confirmations)
        },
        {
          provide: INTEGRATE_WORKSPACE,
          inject: [DATABASE, WORKSPACE_PORT, MANAGE_CONFIRMATIONS],
          useFactory: (
            database: NodraSqliteDatabase,
            workspace: LocalWorkspaceAdapter,
            confirmations: ManageConfirmations
          ) => new IntegrateWorkspace(new SqliteWorkspaceRepository(database), workspace, confirmations)
        },
        {
          provide: DELETE_WORKSPACE,
          inject: [DATABASE, WORKSPACE_PORT],
          useFactory: (
            database: NodraSqliteDatabase,
            workspace: LocalWorkspaceAdapter
          ) => new DeleteWorkspace(
            new SqliteWorkspaceRepository(database),
            workspace,
            new SqliteWorkspaceDeletionReservation(database)
          )
        },
        {
          provide: RESTORE_WORKSPACE,
          inject: [DATABASE, WORKSPACE_PORT],
          useFactory: (database: NodraSqliteDatabase, workspace: LocalWorkspaceAdapter) =>
            new RestoreWorkspace(new SqliteWorkspaceRepository(database), workspace)
        },
        {
          provide: READ_EVIDENCE,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ReadEvidence(new SqliteEvidenceRepository(database))
        },
        {
          provide: COLLECT_EVIDENCE,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => {
            const repository = new SqliteEvidenceRepository(database); const git = new ReadOnlyGitObservationAdapter();
            return new CollectEvidence(repository, new ContentAddressedBlobStore(options.dataRoot ?? dirname(options.databaseFile)), new LocalCommandObservationAdapter(git), git);
          }
        },
        {
          provide: MANAGE_GATES,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => {
            const evidence = new SqliteEvidenceRepository(database); const git = new ReadOnlyGitObservationAdapter();
            return new ManageGates(new SqliteGateRepository(database), evidence, new ContentAddressedBlobStore(options.dataRoot ?? dirname(options.databaseFile)), new StructuredGateEvaluatorRegistry(), git);
          }
        },
        { provide: MANAGE_APPROVALS, inject: [DATABASE], useFactory: (database: NodraSqliteDatabase) => new ManageApprovals(new SqliteApprovalRepository(database)) },
        { provide: MANAGE_DELIVERY, inject: [DATABASE, MANAGE_GATES], useFactory: (database: NodraSqliteDatabase, gates: ManageGates) => new ManageDelivery(new SqliteDeliveryRepository(database), gates) },
        {
          provide: PROVIDER_REGISTRY,
          useFactory: () => new ProviderRegistry([
            new CodexProviderAdapter(),
            new OpenCodeProviderAdapter({
              baseUrl: options.opencodeBaseUrl
                ?? process.env.NODRA_OPENCODE_URL
                ?? "http://127.0.0.1:4096",
              executionTimeoutMs: Number(process.env.NODRA_OPENCODE_EXECUTION_TIMEOUT_MS ?? "300000")
            })
          ])
        },
        {
          provide: PROVIDER_CATALOG,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new SqliteProviderCatalogRepository(database)
        },
        {
          provide: AGENT_CONFIG_REPOSITORY,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new SqliteAgentConfigRepository(database)
        },
        {
          provide: RESOLVE_AGENT_CONFIG,
          inject: [AGENT_CONFIG_REPOSITORY, PROVIDER_CATALOG],
          useFactory: (
            configs: SqliteAgentConfigRepository,
            catalog: SqliteProviderCatalogRepository
          ) => new ResolveAgentConfig(configs, catalog)
        },
        {
          provide: ENABLE_AGENT_CONFIG,
          inject: [DATABASE, AGENT_CONFIG_REPOSITORY],
          useFactory: (database: NodraSqliteDatabase, configs: SqliteAgentConfigRepository) =>
            new EnableAgentConfig(new SqliteMissionRepository(database), configs)
        },
        {
          provide: GET_AGENT_CONFIG,
          inject: [AGENT_CONFIG_REPOSITORY],
          useFactory: (configs: SqliteAgentConfigRepository) => new GetAgentConfig(configs)
        },
        {
          provide: UPDATE_AGENT_CONFIG,
          inject: [AGENT_CONFIG_REPOSITORY],
          useFactory: (configs: SqliteAgentConfigRepository) => new UpdateAgentConfig(configs)
        },
        {
          provide: PREVIEW_AGENT_CONFIG,
          inject: [RESOLVE_AGENT_CONFIG],
          useFactory: (resolver: ResolveAgentConfig) => new PreviewAgentConfig(resolver)
        },
        {
          provide: PROBE_PROVIDER,
          inject: [PROVIDER_REGISTRY, PROVIDER_CATALOG],
          useFactory: (providers: ProviderRegistry, catalog: SqliteProviderCatalogRepository) =>
            new ProbeProvider(providers, catalog)
        },
        {
          provide: GET_PROVIDER_STATUS,
          inject: [PROVIDER_CATALOG, PROVIDER_REGISTRY],
          useFactory: (
            catalog: SqliteProviderCatalogRepository,
            providers: ProviderRegistry
          ) => new GetProviderStatus(catalog, providers)
        },
        {
          provide: TEMPORAL_CONNECTION,
          useFactory: () => new LazyTemporalConnection({
            address: options.temporalAddress ?? "127.0.0.1:7233",
            namespace: options.temporalNamespace ?? "nodra"
          })
        },
        {
          provide: GET_HEALTH,
          inject: [DATABASE, TEMPORAL_CONNECTION, PROVIDER_CATALOG],
          useFactory: (
            database: NodraSqliteDatabase,
            temporal: LazyTemporalConnection,
            catalog: SqliteProviderCatalogRepository
          ) => new GetHealth(
            new SqliteHealthProbe(database),
            temporal,
            new CatalogProviderHealthProbe(catalog, "codex")
          )
        },
        {
          provide: START_MISSION,
          inject: [DATABASE, TEMPORAL_CONNECTION, PROVIDER_CATALOG, RESOLVE_AGENT_CONFIG],
          useFactory: (
            database: NodraSqliteDatabase,
            temporal: LazyTemporalConnection,
            catalog: SqliteProviderCatalogRepository,
            resolver: ResolveAgentConfig
          ) => {
            const repository = new SqliteMissionRepository(database);
            return new StartMission(
              repository,
              new SqliteMissionExecutionRepository(database),
              temporal,
              catalog,
              resolver
            );
          }
        },
        {
          provide: CANCEL_RUN,
          inject: [DATABASE, TEMPORAL_CONNECTION],
          useFactory: (database: NodraSqliteDatabase, temporal: LazyTemporalConnection) =>
            new CancelRun(new SqliteRunControlRepository(database), new LazyTemporalWorkflowAdapter(temporal))
        },
        {
          provide: RESUME_RUN,
          inject: [DATABASE, TEMPORAL_CONNECTION],
          useFactory: (database: NodraSqliteDatabase, temporal: LazyTemporalConnection) =>
            new ResumeRun(new SqliteRunControlRepository(database), new LazyTemporalWorkflowAdapter(temporal))
        },
        {
          provide: STEER_RUN,
          inject: [DATABASE, TEMPORAL_CONNECTION],
          useFactory: (database: NodraSqliteDatabase, temporal: LazyTemporalConnection) =>
            new SteerRun(new SqliteRunControlRepository(database), new LazyTemporalWorkflowAdapter(temporal))
        },
        {
          provide: DISPATCH_WORKFLOW_OUTBOX,
          inject: [DATABASE, TEMPORAL_CONNECTION],
          useFactory: (database: NodraSqliteDatabase, temporal: LazyTemporalConnection) =>
            new DispatchWorkflowOutbox(
              new SqliteWorkflowOutboxStore(database),
              new LazyTemporalWorkflowAdapter(temporal)
            )
        },
        {
          provide: RECONCILE_WORKFLOWS,
          inject: [DATABASE, TEMPORAL_CONNECTION],
          useFactory: (database: NodraSqliteDatabase, temporal: LazyTemporalConnection) =>
            new ReconcileWorkflows(
              new SqliteWorkflowReconciliationStore(database),
              new LazyTemporalWorkflowAdapter(temporal)
            )
        },
        {
          provide: CREATE_MISSION,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new CreateMission(new SqliteMissionRepository(database))
        },
        {
          provide: CHANGE_MISSION_STATE,
          inject: [DATABASE, RESOLVE_AGENT_CONFIG],
          useFactory: (database: NodraSqliteDatabase, resolver: ResolveAgentConfig) =>
            new ChangeMissionState(new SqliteMissionRepository(database), resolver)
        },
        {
          provide: LIST_MISSIONS,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ListMissions(new SqliteMissionReadModel(database))
        },
        {
          provide: SHOW_MISSION,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ShowMission(new SqliteMissionReadModel(database))
        },
        {
          provide: CREATE_PIPELINE,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new CreatePipeline(new SqlitePipelineRepository(database))
        },
        {
          provide: SHOW_PIPELINE,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ShowPipeline(new SqlitePipelineRepository(database))
        },
        {
          provide: SHOW_PIPELINE_RUN,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ShowPipelineRun(new SqlitePipelineRepository(database))
        },
        {
          provide: START_PIPELINE,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new StartPipeline(new SqlitePipelineRepository(database))
        },
        {
          provide: ADVANCE_PIPELINE,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new AdvancePipeline(new SqlitePipelineRepository(database))
        },
        {
          provide: GET_RELAY,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new GetRelay(new SqliteMissionReadModel(database))
        },
        { provide: APP_FILTER, useClass: BusinessErrorFilter },
        DatabaseLifecycle,
        RuntimeLifecycle
      ]
    };
  }
}
