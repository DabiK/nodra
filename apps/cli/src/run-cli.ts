import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
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
  AdvancePipeline,
  ApprovePipelineNodeTransition,
  ChangeMissionState,
  CancelRun,
  CommitWorkspace,
  CollectEvidence,
  CreateMission,
  CreatePipeline,
  CreateWorkspace,
  DeleteWorkspace,
  DispatchWorkflowOutbox,
  EnableAgentConfig,
  CatalogProviderHealthProbe,
  GetHealth,
  GetProviderStatus,
  GetRelay,
  GetAgentConfig,
  ListMissions,
  ManageApprovals,
  ManageConfirmations,
  ManageDelivery,
  ManageGates,
  ReadEvidence,
  ReadWorkspace,
  ResumeRun,
  ReconcileWorkflows,
  ShowMission,
  ShowPipeline,
  ShowPipelineRun,
  SetPipelineNodeTransitionMode,
  SnapshotWorkspace,
  StartMission,
  StartPipeline,
  SteerRun,
  ProbeProvider,
  ProviderRegistry,
  PreviewAgentConfig,
  PublishPipelineNodeHandover,
  ResolveAgentConfig,
  SmokeProvider,
  StructuredGateEvaluatorRegistry,
  IntegrateWorkspace,
  RestoreWorkspace,
  UpdateAgentConfig
} from "@nodra/application";
import { ConsoleOutput } from "./console-output.js";
import {
  CLI_HELP,
  isCliHelpRequest,
  NodraCli
} from "./nodra-cli.js";
import { I4Cli } from "./i4-cli.js";
import { EvidenceCli } from "./evidence-cli.js";
import { GateCli } from "./gate-cli.js";
import { ApprovalCli } from "./approval-cli.js";
import { DeliveryCli } from "./delivery-cli.js";
import { ConfirmationCli } from "./confirmation-cli.js";
import { WorkspaceCli } from "./workspace-cli.js";
import { I6Cli } from "./i6-cli.js";
import { ProviderSmokeCli } from "./provider-smoke-cli.js";
import { AgentConfigCli } from "./agent-config-cli.js";
import { PipelineCli } from "./pipeline-cli.js";
import { ConversationCli } from "./conversation-cli.js";

export const runCli = async (
  arguments_: readonly string[],
  databaseFile: string,
  migrationsDirectory: string,
  temporalAddress = process.env.NODRA_TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
  temporalNamespace = process.env.NODRA_TEMPORAL_NAMESPACE ?? "nodra",
  dataRoot = process.env.NODRA_DATA_ROOT ?? dirname(databaseFile)
): Promise<number> => {
  const output = new ConsoleOutput();

  if (isCliHelpRequest(arguments_)) {
    output.write(CLI_HELP);
    return 0;
  }
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
    const codex = new CodexProviderAdapter();
    const providers = new ProviderRegistry([
      codex,
      new OpenCodeProviderAdapter({
        baseUrl: process.env.NODRA_OPENCODE_URL ?? "http://127.0.0.1:4096",
        executionTimeoutMs: Number(process.env.NODRA_OPENCODE_EXECUTION_TIMEOUT_MS ?? "300000")
      })
    ]);
    const providerCatalog = new SqliteProviderCatalogRepository(database);
    const agentConfigs = new SqliteAgentConfigRepository(database);
    const agentResolver = new ResolveAgentConfig(agentConfigs, providerCatalog);
    const pipelineRepository = new SqlitePipelineRepository(database);
    const workflow = new LazyTemporalWorkflowAdapter(temporal);
    const confirmations = new ManageConfirmations(new SqliteConfirmationRepository(database), workspace);
    const cli = new NodraCli(
      new GetHealth(
        new SqliteHealthProbe(database),
        temporal,
        new CatalogProviderHealthProbe(providerCatalog, codex.providerId)
      ),
      new CreateMission(repository),
      new ChangeMissionState(repository, agentResolver),
      new ListMissions(readModel),
      new ShowMission(readModel),
      new GetRelay(readModel),
      new StartMission(
        repository,
        new SqliteMissionExecutionRepository(database),
        temporal,
        providerCatalog,
        agentResolver
      ),
      new DispatchWorkflowOutbox(
        new SqliteWorkflowOutboxStore(database),
        workflow
      ),
      new ReconcileWorkflows(
        new SqliteWorkflowReconciliationStore(database),
        workflow
      ),
      output,
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
          new DeleteWorkspace(
            workspaceRepository,
            workspace,
            new SqliteWorkspaceDeletionReservation(database)
          ),
          new RestoreWorkspace(workspaceRepository, workspace)
        ),
        new PipelineCli(
          new CreatePipeline(pipelineRepository),
          new ShowPipeline(pipelineRepository),
          new ShowPipelineRun(pipelineRepository),
          new StartPipeline(pipelineRepository),
          new AdvancePipeline(pipelineRepository),
          new SetPipelineNodeTransitionMode(pipelineRepository),
          new ApprovePipelineNodeTransition(pipelineRepository),
          new PublishPipelineNodeHandover(pipelineRepository),
          new ShowMission(readModel),
          new StartMission(
            repository,
            new SqliteMissionExecutionRepository(database),
            temporal,
            providerCatalog,
            agentResolver
          )
        ),
        new ConversationCli(database)
      ]),
      new I6Cli(
        new GetProviderStatus(providerCatalog, providers),
        new ProbeProvider(providers, providerCatalog),
        new CancelRun(new SqliteRunControlRepository(database), workflow),
        new ResumeRun(new SqliteRunControlRepository(database), workflow),
        new SteerRun(new SqliteRunControlRepository(database), workflow),
        new ProviderSmokeCli(
          new SmokeProvider(providers, providerCatalog),
          dataRoot
        )
      ),
      new AgentConfigCli(
        new EnableAgentConfig(repository, agentConfigs),
        new GetAgentConfig(agentConfigs),
        new UpdateAgentConfig(agentConfigs),
        new PreviewAgentConfig(agentResolver)
      )
    );
    return await cli.run(arguments_);
  } finally {
    await temporal.close();
    database.close();
  }
};
