import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import {
  ContentAddressedBlobStore,
  LazyTemporalConnection,
  LazyTemporalWorkflowAdapter,
  LocalCommandObservationAdapter,
  LocalWorkspaceAdapter,
  migrateDatabase,
  NodraSqliteDatabase,
  ReadOnlyGitObservationAdapter,
  SqliteApprovalRepository,
  SqliteDeliveryRepository,
  SqliteEvidenceRepository,
  SqliteGateRepository,
  SqliteHealthProbe,
  SqliteMissionReadModel,
  SqliteMissionRepository,
  SqliteMissionExecutionRepository,
  SqliteConfirmationRepository,
  SqliteWorkspaceRepository,
  SqliteWorkflowOutboxStore,
  SqliteWorkflowReconciliationStore
} from "@nodra/adapters";
import {
  ChangeMissionState,
  CommitWorkspace,
  CollectEvidence,
  CreateMission,
  CreateWorkspace,
  DeleteWorkspace,
  DispatchWorkflowOutbox,
  GetHealth,
  GetRelay,
  ListMissions,
  ManageApprovals,
  ManageConfirmations,
  ManageDelivery,
  ManageGates,
  ReadEvidence,
  ReadWorkspace,
  ReconcileWorkflows,
  ShowMission,
  SnapshotWorkspace,
  StartMission,
  StructuredGateEvaluatorRegistry,
  IntegrateWorkspace,
  RestoreWorkspace
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
import {
  CHANGE_MISSION_STATE,
  CREATE_MISSION,
  DATABASE,
  GET_HEALTH,
  GET_RELAY,
  LIST_MISSIONS,
  SHOW_MISSION,
  START_MISSION,
  DISPATCH_WORKFLOW_OUTBOX,
  RECONCILE_WORKFLOWS,
  TEMPORAL_CONNECTION,
  READ_EVIDENCE,
  COLLECT_EVIDENCE,
  MANAGE_GATES,
  MANAGE_APPROVALS,
  MANAGE_DELIVERY,
  WORKSPACE_PORT,
  MANAGE_CONFIRMATIONS,
  CREATE_WORKSPACE,
  READ_WORKSPACE,
  SNAPSHOT_WORKSPACE,
  COMMIT_WORKSPACE,
  INTEGRATE_WORKSPACE,
  DELETE_WORKSPACE,
  RESTORE_WORKSPACE
} from "./tokens.js";

export interface NodraModuleOptions {
  databaseFile: string;
  migrationsDirectory: string;
  temporalAddress?: string;
  temporalNamespace?: string;
  dataRoot?: string;
}

@Module({})
export class NodraModule {
  static register(options: NodraModuleOptions): DynamicModule {
    return {
      module: NodraModule,
      controllers: [HealthController, MissionController, RelayController, RuntimeController, EvidenceController, GateController, ApprovalController, DeliveryController, ConfirmationController, WorkspaceController],
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
          inject: [DATABASE, WORKSPACE_PORT, MANAGE_CONFIRMATIONS],
          useFactory: (
            database: NodraSqliteDatabase,
            workspace: LocalWorkspaceAdapter,
            confirmations: ManageConfirmations
          ) => new DeleteWorkspace(new SqliteWorkspaceRepository(database), workspace, confirmations)
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
          provide: TEMPORAL_CONNECTION,
          useFactory: () => new LazyTemporalConnection({
            address: options.temporalAddress ?? "127.0.0.1:7233",
            namespace: options.temporalNamespace ?? "nodra"
          })
        },
        {
          provide: GET_HEALTH,
          inject: [DATABASE, TEMPORAL_CONNECTION],
          useFactory: (database: NodraSqliteDatabase, temporal: LazyTemporalConnection) =>
            new GetHealth(new SqliteHealthProbe(database), temporal)
        },
        {
          provide: START_MISSION,
          inject: [DATABASE, TEMPORAL_CONNECTION],
          useFactory: (database: NodraSqliteDatabase, temporal: LazyTemporalConnection) => {
            const repository = new SqliteMissionRepository(database);
            return new StartMission(repository, new SqliteMissionExecutionRepository(database), temporal);
          }
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
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ChangeMissionState(new SqliteMissionRepository(database))
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
