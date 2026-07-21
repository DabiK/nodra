import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  migrateDatabase,
  LazyTemporalConnection,
  LazyTemporalWorkflowAdapter,
  NodraSqliteDatabase,
  SqliteHealthProbe,
  SqliteMissionReadModel,
  SqliteMissionRepository,
  SqliteMissionExecutionRepository,
  SqliteWorkflowOutboxStore,
  SqliteWorkflowReconciliationStore
} from "@nodra/adapters";
import {
  ChangeMissionState,
  CreateMission,
  DispatchWorkflowOutbox,
  GetHealth,
  GetRelay,
  ListMissions,
  ReconcileWorkflows,
  ShowMission,
  StartMission
} from "@nodra/application";
import { ConsoleOutput } from "./console-output.js";
import { NodraCli } from "./nodra-cli.js";

export const runCli = async (
  arguments_: readonly string[],
  databaseFile: string,
  migrationsDirectory: string,
  temporalAddress = process.env.NODRA_TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
  temporalNamespace = process.env.NODRA_TEMPORAL_NAMESPACE ?? "nodra"
): Promise<number> => {
  await mkdir(dirname(databaseFile), { recursive: true });
  const database = NodraSqliteDatabase.open(databaseFile);
  const temporal = new LazyTemporalConnection({ address: temporalAddress, namespace: temporalNamespace });
  try {
    await migrateDatabase(database, migrationsDirectory);
    const repository = new SqliteMissionRepository(database);
    const readModel = new SqliteMissionReadModel(database);
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
      new ConsoleOutput()
    );
    return await cli.run(arguments_);
  } finally {
    await temporal.close();
    database.close();
  }
};
