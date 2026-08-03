import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import {
  ContentAddressedBlobStore,
  CodexProviderAdapter,
  CodexProviderOneShotAdapter,
  CodexProviderSessionControlAdapter,
  CodexProviderSessionSyncAdapter,
  OpenCodeProviderAdapter,
  OpenCodeProviderOneShotAdapter,
  OpenCodeProviderSessionControlAdapter,
  OpenCodeProviderSessionSyncAdapter,
  LazyTemporalConnection,
  LazyTemporalWorkflowAdapter,
  LocalCommandObservationAdapter,
  LocalWorkspaceAdapter,
  migrateDatabase,
  NodraSqliteDatabase,
  ReadOnlyGitObservationAdapter,
  SqliteApprovalRepository,
  SqliteAgentConfigRepository,
  SqliteActivityRepository,
  SqliteDeliveryRepository,
  SqliteEvidenceRepository,
  SqliteGateRepository,
  SqliteHealthProbe,
  SqliteMissionReadModel,
  SqliteMissionRepository,
  SqliteMissionExecutionRepository,
  SqliteManagerRepository,
  SqliteManagerReadModel,
  SqliteManagerExecutionRepository,
  SqlitePipelineRepository,
  SqliteProviderCatalogRepository,
  SqliteProviderSessionRepository,
  SqliteRunControlRepository,
  SqliteConfirmationRepository,
  SqliteWorkspaceRepository,
  SqliteWorkspaceDeletionReservation,
  SqliteTagRepository,
  SqliteWorkflowOutboxStore,
  SqliteWorkflowReconciliationStore
} from "@nodra/adapters";
import {
  ActivateProviderSessionMission,
  AutoValidateMissionAfterTurn,
  ChangeMissionState,
  AdvancePipeline,
  AttachProviderSession,
  ApprovePipelineNodeTransition,
  ArchiveManager,
  CancelRun,
  CatalogProviderHealthProbe,
  CommitWorkspace,
  CollectEvidence,
  CreateManager,
  CreateActiveMissionForProviderSession,
  CreateMission,
  CreatePipeline,
  CreateWorkspace,
  DeleteWorkspace,
  DiffWorkspace,
  DispatchWorkflowOutbox,
  EnableAgentConfig,
  EnsureMissionObservationSession,
  EnhancePrompt,
  GetAgentConfig,
  GetHealth,
  GetProviderStatus,
  GetRelay,
  GetProviderSessionSyncCapabilities,
  GetMissionProviderSessionControlCapabilities,
  ListMissions,
  ListMissionRuns,
  ListMissionAudit,
  ListMissionTags,
  ListActivity,
  ListTags,
  CreateTag,
  UpdateTag,
  DeleteTag,
  SetMissionTags,
  ListManagerConversations,
  ListManagerTimeline,
  ListProviderSessions,
  ListManagers,
  ManageApprovals,
  ManageConfirmations,
  ManageDelivery,
  ManageGates,
  MarkActivityRead,
  ReadEvidence,
  ReadWorkspace,
  ResumeRun,
  ReconcileWorkflows,
  ShowPipeline,
  ShowPipelineRun,
  ListPipelines,
  SetPipelineNodeTransitionMode,
  ShowMission,
  ShowProviderSession,
  ShowManager,
  SnapshotWorkspace,
  StartManagerRun,
  StartMission,
  StartProviderSessionTurn,
  StartPipeline,
  SteerRun,
  SteerProviderSessionTurn,
  ProbeProvider,
  PublishPipelineNodeHandover,
  ProviderRegistry,
  ProviderOneShotRegistry,
  ProviderSessionControlRegistry,
  ProviderSessionSyncRegistry,
  PreviewAgentConfig,
  ReadMissionProviderSession,
  ResolveMissionProviderSession,
  ResolveAgentConfig,
  StructuredGateEvaluatorRegistry,
  IntegrateWorkspace,
  RestoreWorkspace,
  ResolveWorktree,
  UpdateAgentConfig,
  UpdateManager,
  toId
} from "@nodra/application";
import type { ProviderSessionControlPort, ProviderSessionSyncPort } from "@nodra/application";
import { ApprovalController } from "./approval.controller.js";
import { AgentSessionController } from "./agent-session.controller.js";
import { BusinessErrorFilter } from "./business-error.filter.js";
import { DatabaseLifecycle } from "./database-lifecycle.js";
import { ProviderProbeLifecycle } from "./provider-probe-lifecycle.js";
import { DeliveryController } from "./delivery.controller.js";
import { ConfirmationController } from "./confirmation.controller.js";
import { EvidenceController } from "./evidence.controller.js";
import { GateController } from "./gate.controller.js";
import { FolderController } from "./folder.controller.js";
import { HealthController } from "./health.controller.js";
import { MissionController } from "./mission.controller.js";
import { ManagerController } from "./manager.controller.js";
import { ConfigController } from "./config.controller.js";
import { RelayController } from "./relay.controller.js";
import { ActivityController } from "./activity.controller.js";
import { TagController } from "./tag.controller.js";
import { RuntimeController } from "./runtime.controller.js";
import { RuntimeLifecycle } from "./runtime-lifecycle.js";
import { WorkspaceController } from "./workspace.controller.js";
import { ProviderController } from "./provider.controller.js";
import { ProviderSessionController } from "./provider-session.controller.js";
import { PipelineController } from "./pipeline.controller.js";
import { LlmController } from "./llm.controller.js";
import { RunController } from "./run.controller.js";
import { EventsController } from "./events.controller.js";
import { SseEventsService } from "./sse-events.service.js";
import { DatabaseChangeWatcher } from "./database-change-watcher.js";
import {
  AGENT_CONFIG_REPOSITORY,
  ADVANCE_PIPELINE,
  APPROVE_PIPELINE_NODE_TRANSITION,
  ARCHIVE_MANAGER,
  CANCEL_RUN,
  CHANGE_MISSION_STATE,
  COLLECT_EVIDENCE,
  COMMIT_WORKSPACE,
  CREATE_WORKSPACE,
  CREATE_MANAGER,
  CREATE_MISSION,
  CREATE_PIPELINE,
  DATA_ROOT,
  DATABASE,
  DATABASE_FILE,
  DELETE_WORKSPACE,
  DIFF_WORKSPACE,
  DISPATCH_WORKFLOW_OUTBOX,
  GET_HEALTH,
  GET_PROVIDER_STATUS,
  GET_RELAY,
  INTEGRATE_WORKSPACE,
  LIST_ACTIVITY,
  LIST_TAGS,
  CREATE_TAG,
  UPDATE_TAG,
  DELETE_TAG,
  LIST_MISSION_TAGS,
  SET_MISSION_TAGS,
  LIST_MANAGER_CONVERSATIONS,
  LIST_MANAGER_TIMELINE,
  LIST_MANAGERS,
  LIST_MISSIONS,
  LIST_MISSION_RUNS,
  LIST_MISSION_AUDIT,
  MANAGE_APPROVALS,
  MANAGE_CONFIRMATIONS,
  MANAGE_DELIVERY,
  MANAGE_GATES,
  MARK_ACTIVITY_READ,
  PROBE_PROVIDER,
  PUBLISH_PIPELINE_NODE_HANDOVER,
  PROVIDER_CATALOG,
  PROVIDER_REGISTRY,
  PROVIDER_SESSION_SYNC_REGISTRY,
  LIST_PROVIDER_SESSIONS,
  SHOW_PROVIDER_SESSION,
  ATTACH_PROVIDER_SESSION,
  CREATE_ACTIVE_MISSION_FOR_PROVIDER_SESSION,
  GET_PROVIDER_SESSION_SYNC_CAPABILITIES,
  PROVIDER_SESSION_CONTROL_REGISTRY,
  READ_MISSION_PROVIDER_SESSION,
  GET_MISSION_PROVIDER_SESSION_CONTROL_CAPABILITIES,
  ACTIVATE_PROVIDER_SESSION_MISSION,
  ENSURE_MISSION_OBSERVATION_SESSION,
  START_PROVIDER_SESSION_TURN,
  STEER_PROVIDER_SESSION_TURN,
  PROVIDER_ONE_SHOT_REGISTRY,
  ENHANCE_PROMPT,
  READ_EVIDENCE,
  READ_WORKSPACE,
  RECONCILE_WORKFLOWS,
  REPOSITORY_ROOT,
  RESTORE_WORKSPACE,
  RESOLVE_WORKTREE,
  RESUME_RUN,
  SHOW_MANAGER,
  SHOW_MISSION,
  SHOW_PIPELINE,
  LIST_PIPELINES,
  SHOW_PIPELINE_RUN,
  SET_PIPELINE_NODE_TRANSITION_MODE,
  SNAPSHOT_WORKSPACE,
  START_MANAGER_RUN,
  START_MISSION,
  START_PIPELINE,
  STEER_RUN,
  TEMPORAL_CONNECTION,
  UPDATE_MANAGER,
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
  repositoryRoot?: string;
  temporalAddress?: string;
  temporalNamespace?: string;
  dataRoot?: string;
  opencodeBaseUrl?: string;
  providerSessionSyncPorts?: readonly ProviderSessionSyncPort[];
  providerSessionControlPorts?: readonly ProviderSessionControlPort[];
}

@Module({})
export class NodraModule {
  static register(options: NodraModuleOptions): DynamicModule {
    return {
      module: NodraModule,
      controllers: [HealthController, MissionController, ManagerController, ConfigController, RelayController, ActivityController, TagController, RuntimeController, EvidenceController, GateController, FolderController, AgentSessionController, ApprovalController, DeliveryController, ConfirmationController, WorkspaceController, ProviderController, ProviderSessionController, RunController, PipelineController, LlmController, EventsController],
      providers: [
        { provide: REPOSITORY_ROOT, useValue: options.repositoryRoot ?? process.cwd() },
        { provide: DATA_ROOT, useValue: options.dataRoot ?? dirname(options.databaseFile) },
        { provide: DATABASE_FILE, useValue: resolve(options.databaseFile) },
        SseEventsService,
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
          provide: DIFF_WORKSPACE,
          inject: [DATABASE, WORKSPACE_PORT],
          useFactory: (database: NodraSqliteDatabase, workspace: LocalWorkspaceAdapter) =>
            new DiffWorkspace(new SqliteWorkspaceRepository(database), workspace)
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
          provide: RESOLVE_WORKTREE,
          inject: [DATABASE, WORKSPACE_PORT],
          useFactory: (database: NodraSqliteDatabase, workspace: LocalWorkspaceAdapter) =>
            new ResolveWorktree(new SqliteWorkspaceRepository(database), workspace)
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
          provide: PROVIDER_SESSION_SYNC_REGISTRY,
          useFactory: () => new ProviderSessionSyncRegistry(
            options.providerSessionSyncPorts ?? [
              new CodexProviderSessionSyncAdapter(),
              new OpenCodeProviderSessionSyncAdapter({
                baseUrl: options.opencodeBaseUrl
                  ?? process.env.NODRA_OPENCODE_URL
                  ?? "http://127.0.0.1:4096"
              })
            ]
          )
        },
        {
          provide: PROVIDER_SESSION_CONTROL_REGISTRY,
          useFactory: () => new ProviderSessionControlRegistry(
            options.providerSessionControlPorts ?? [
              new CodexProviderSessionControlAdapter(),
              new OpenCodeProviderSessionControlAdapter({
                baseUrl: options.opencodeBaseUrl
                  ?? process.env.NODRA_OPENCODE_URL
                  ?? "http://127.0.0.1:4096",
                executionTimeoutMs: Number(process.env.NODRA_OPENCODE_EXECUTION_TIMEOUT_MS ?? "300000")
              })
            ]
          )
        },
        {
          provide: PROVIDER_ONE_SHOT_REGISTRY,
          useFactory: () => new ProviderOneShotRegistry([
            new CodexProviderOneShotAdapter(),
            new OpenCodeProviderOneShotAdapter({
              baseUrl: options.opencodeBaseUrl
                ?? process.env.NODRA_OPENCODE_URL
                ?? "http://127.0.0.1:4096",
              executionTimeoutMs: Number(process.env.NODRA_OPENCODE_EXECUTION_TIMEOUT_MS ?? "300000")
            })
          ])
        },
        {
          provide: ENHANCE_PROMPT,
          inject: [PROVIDER_ONE_SHOT_REGISTRY],
          useFactory: (providers: ProviderOneShotRegistry) => new EnhancePrompt(providers)
        },
        {
          provide: LIST_PROVIDER_SESSIONS,
          inject: [PROVIDER_SESSION_SYNC_REGISTRY, DATABASE],
          useFactory: (providers: ProviderSessionSyncRegistry, database: NodraSqliteDatabase) =>
            new ListProviderSessions(providers, new SqliteProviderSessionRepository(database), {
              next: () => toId(randomUUID())
            })
        },
        {
          provide: SHOW_PROVIDER_SESSION,
          inject: [PROVIDER_SESSION_SYNC_REGISTRY, DATABASE],
          useFactory: (providers: ProviderSessionSyncRegistry, database: NodraSqliteDatabase) =>
            new ShowProviderSession(providers, new SqliteProviderSessionRepository(database))
        },
        {
          provide: GET_PROVIDER_SESSION_SYNC_CAPABILITIES,
          inject: [PROVIDER_SESSION_SYNC_REGISTRY],
          useFactory: (providers: ProviderSessionSyncRegistry) => new GetProviderSessionSyncCapabilities(providers)
        },
        {
          provide: ATTACH_PROVIDER_SESSION,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) =>
            new AttachProviderSession(new SqliteProviderSessionRepository(database))
        },
        {
          provide: CREATE_ACTIVE_MISSION_FOR_PROVIDER_SESSION,
          inject: [PROVIDER_SESSION_SYNC_REGISTRY, DATABASE],
          useFactory: (providers: ProviderSessionSyncRegistry, database: NodraSqliteDatabase) =>
            new CreateActiveMissionForProviderSession(providers, new SqliteProviderSessionRepository(database))
        },
        {
          provide: READ_MISSION_PROVIDER_SESSION,
          inject: [PROVIDER_SESSION_SYNC_REGISTRY, DATABASE],
          useFactory: (providers: ProviderSessionSyncRegistry, database: NodraSqliteDatabase) =>
            new ReadMissionProviderSession(providers, new SqliteProviderSessionRepository(database))
        },
        {
          provide: GET_MISSION_PROVIDER_SESSION_CONTROL_CAPABILITIES,
          inject: [PROVIDER_SESSION_CONTROL_REGISTRY, DATABASE],
          useFactory: (controls: ProviderSessionControlRegistry, database: NodraSqliteDatabase) =>
            new GetMissionProviderSessionControlCapabilities(controls, new SqliteProviderSessionRepository(database))
        },
        {
          provide: ACTIVATE_PROVIDER_SESSION_MISSION,
          inject: [PROVIDER_SESSION_CONTROL_REGISTRY, DATABASE],
          useFactory: (controls: ProviderSessionControlRegistry, database: NodraSqliteDatabase) =>
            new ActivateProviderSessionMission(controls, new SqliteProviderSessionRepository(database))
        },
        {
          provide: ENSURE_MISSION_OBSERVATION_SESSION,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) =>
            new EnsureMissionObservationSession(
              new SqliteProviderSessionRepository(database),
              new ResolveMissionProviderSession(new SqliteProviderSessionRepository(database))
            )
        },
        {
          provide: START_PROVIDER_SESSION_TURN,
          inject: [PROVIDER_SESSION_CONTROL_REGISTRY, DATABASE, PROVIDER_SESSION_SYNC_REGISTRY],
          useFactory: (controls: ProviderSessionControlRegistry, database: NodraSqliteDatabase, providers: ProviderSessionSyncRegistry) =>
            new StartProviderSessionTurn(
              controls,
              new SqliteProviderSessionRepository(database),
              new AutoValidateMissionAfterTurn(new SqliteMissionRepository(database), providers)
            )
        },
        {
          provide: STEER_PROVIDER_SESSION_TURN,
          inject: [PROVIDER_SESSION_CONTROL_REGISTRY, DATABASE, PROVIDER_SESSION_SYNC_REGISTRY],
          useFactory: (controls: ProviderSessionControlRegistry, database: NodraSqliteDatabase, providers: ProviderSessionSyncRegistry) =>
            new SteerProviderSessionTurn(
              controls,
              new SqliteProviderSessionRepository(database),
              new AutoValidateMissionAfterTurn(new SqliteMissionRepository(database), providers)
            )
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
              resolver,
              new SqliteProviderSessionRepository(database)
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
          provide: LIST_MISSION_RUNS,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ListMissionRuns(new SqliteMissionReadModel(database))
        },
        {
          provide: LIST_MISSION_AUDIT,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ListMissionAudit(new SqliteMissionReadModel(database))
        },
        {
          provide: LIST_MISSION_TAGS,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) =>
            new ListMissionTags(new SqliteTagRepository(database), new SqliteMissionReadModel(database))
        },
        {
          provide: SET_MISSION_TAGS,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) =>
            new SetMissionTags(new SqliteTagRepository(database), new SqliteMissionReadModel(database))
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
          provide: LIST_PIPELINES,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ListPipelines(new SqlitePipelineRepository(database))
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
          provide: SET_PIPELINE_NODE_TRANSITION_MODE,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new SetPipelineNodeTransitionMode(new SqlitePipelineRepository(database))
        },
        {
          provide: APPROVE_PIPELINE_NODE_TRANSITION,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ApprovePipelineNodeTransition(new SqlitePipelineRepository(database))
        },
        {
          provide: PUBLISH_PIPELINE_NODE_HANDOVER,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new PublishPipelineNodeHandover(new SqlitePipelineRepository(database))
        },
        {
          provide: GET_RELAY,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new GetRelay(new SqliteMissionReadModel(database))
        },
        {
          provide: LIST_ACTIVITY,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ListActivity(new SqliteActivityRepository(database))
        },
        {
          provide: LIST_TAGS,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ListTags(new SqliteTagRepository(database))
        },
        {
          provide: CREATE_TAG,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new CreateTag(new SqliteTagRepository(database))
        },
        {
          provide: UPDATE_TAG,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new UpdateTag(new SqliteTagRepository(database))
        },
        {
          provide: DELETE_TAG,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new DeleteTag(new SqliteTagRepository(database))
        },
        {
          provide: MARK_ACTIVITY_READ,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new MarkActivityRead(new SqliteActivityRepository(database))
        },
        {
          provide: CREATE_MANAGER,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new CreateManager(new SqliteManagerRepository(database))
        },
        {
          provide: UPDATE_MANAGER,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new UpdateManager(new SqliteManagerRepository(database))
        },
        {
          provide: ARCHIVE_MANAGER,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ArchiveManager(new SqliteManagerRepository(database))
        },
        {
          provide: LIST_MANAGERS,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ListManagers(new SqliteManagerReadModel(database))
        },
        {
          provide: SHOW_MANAGER,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ShowManager(new SqliteManagerReadModel(database))
        },
        {
          provide: LIST_MANAGER_CONVERSATIONS,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ListManagerConversations(new SqliteManagerReadModel(database))
        },
        {
          provide: LIST_MANAGER_TIMELINE,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ListManagerTimeline(new SqliteManagerReadModel(database))
        },
        {
          provide: START_MANAGER_RUN,
          inject: [DATABASE, TEMPORAL_CONNECTION, PROVIDER_CATALOG],
          useFactory: (
            database: NodraSqliteDatabase,
            temporal: LazyTemporalConnection,
            catalog: SqliteProviderCatalogRepository
          ) => new StartManagerRun(
            new SqliteManagerRepository(database),
            new SqliteManagerExecutionRepository(database),
            temporal,
            catalog
          )
        },
        { provide: APP_FILTER, useClass: BusinessErrorFilter },
        DatabaseLifecycle,
        RuntimeLifecycle,
        ProviderProbeLifecycle,
        DatabaseChangeWatcher
      ]
    };
  }
}
