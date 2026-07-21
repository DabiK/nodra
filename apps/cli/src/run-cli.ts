import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  migrateDatabase,
  NodraSqliteDatabase,
  SqliteHealthProbe,
  SqliteMissionReadModel,
  SqliteMissionRepository
} from "@nodra/adapters";
import { ChangeMissionState, CreateMission, GetHealth, GetRelay, ListMissions, ShowMission } from "@nodra/application";
import { ConsoleOutput } from "./console-output.js";
import { NodraCli } from "./nodra-cli.js";

export const runCli = async (
  arguments_: readonly string[],
  databaseFile: string,
  migrationsDirectory: string
): Promise<number> => {
  await mkdir(dirname(databaseFile), { recursive: true });
  const database = NodraSqliteDatabase.open(databaseFile);
  try {
    await migrateDatabase(database, migrationsDirectory);
    const repository = new SqliteMissionRepository(database);
    const readModel = new SqliteMissionReadModel(database);
    const cli = new NodraCli(
      new GetHealth(new SqliteHealthProbe(database)),
      new CreateMission(repository),
      new ChangeMissionState(repository),
      new ListMissions(readModel),
      new ShowMission(readModel),
      new GetRelay(readModel),
      new ConsoleOutput()
    );
    return await cli.run(arguments_);
  } finally {
    database.close();
  }
};
