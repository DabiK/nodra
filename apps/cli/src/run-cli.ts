import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
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
import { ConsoleOutput } from "./console-output.js";
import { NodraCli } from "./nodra-cli.js";
import { I4Cli } from "./i4-cli.js";
import { EvidenceCli } from "./evidence-cli.js";
import { GateCli } from "./gate-cli.js";
import { ApprovalCli } from "./approval-cli.js";
import { DeliveryCli } from "./delivery-cli.js";
import { ConfirmationCli } from "./confirmation-cli.js";
import { WorkspaceCli } from "./workspace-cli.js";

export const runCli = async (
  arguments_: readonly string[],
  databaseFile: string,
  migrationsDirectory: string,
  temporalAddress = process.env.NODRA_TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
  temporalNamespace = process.env.NODRA_TEMPORAL_NAMESPACE ?? "nodra",
  dataRoot = process.env.NODRA_DATA_ROOT ?? dirname(databaseFile)
): Promise<number> => {
  await mkdir(dirname(databaseFile), { recursive: true });
  const database = NodraSqliteDatabase.open(databaseFile);
  const temporal = new LazyTemporalConnection({ address: temporalAddress, namespace: temporalNamespace });
  try {
    await migrateDatabase(database, migrationsDirectory);
    const repository = new SqliteMissionRepository(database);
    const readModel = new SqliteMissionReadModel(database);
    const evidenceRepository = new SqliteEvidenceRepository(database);
    const git = new ReadOnlyGitObservationAdapter();
    const blobs = new ContentAddressedBlobStore(dataRoot);
    const gates = new SqliteGateRepository(database);
    const manageGates = new ManageGates(gates, evidenceRepository, blobs, new StructuredGateEvaluatorRegistry(), git);
    const workspace = new LocalWorkspaceAdapter(`${dataRoot}/workspaces`);
    await workspace.initialize();
    const workspaceRepository = new SqliteWorkspaceRepository(database);
    const confirmations = new ManageConfirmations(new SqliteConfirmationRepository(database), workspace);
    const cli = new NodraCli(
      new GetHealth(new SqliteHealthProbe(database), temporal),
      new CreateMission(repository),
      new ChangeMissionState(repository),
      new ListMissions(readModel),
      new ShowMission(readModel),
      new GetRelay(readModel),
      new StartMission(repository, new SqliteMissionExecutionRepository(database), temporal),
      new DispatchWorkflowOutbox(
        new SqliteWorkflowOutboxStore(database),
        new LazyTemporalWorkflowAdapter(temporal)
      ),
      new ReconcileWorkflows(
        new SqliteWorkflowReconciliationStore(database),
        new LazyTemporalWorkflowAdapter(temporal)
      ),
      new ConsoleOutput(),
      new I4Cli([
        new EvidenceCli(new ReadEvidence(evidenceRepository), new CollectEvidence(evidenceRepository, blobs, new LocalCommandObservationAdapter(git), git)),
        new GateCli(manageGates),
        new ApprovalCli(new ManageApprovals(new SqliteApprovalRepository(database))),
        new DeliveryCli(new ManageDelivery(new SqliteDeliveryRepository(database), manageGates)),
        new ConfirmationCli(confirmations),
        new WorkspaceCli(
          new CreateWorkspace(workspaceRepository, workspace),
          new ReadWorkspace(workspaceRepository),
          new SnapshotWorkspace(workspaceRepository, workspace),
          new CommitWorkspace(workspaceRepository, workspace, confirmations),
          new IntegrateWorkspace(workspaceRepository, workspace, confirmations),
          new DeleteWorkspace(workspaceRepository, workspace, confirmations),
          new RestoreWorkspace(workspaceRepository, workspace)
        )
      ])
    );
    return await cli.run(arguments_);
  } finally {
    await temporal.close();
    database.close();
  }
};
