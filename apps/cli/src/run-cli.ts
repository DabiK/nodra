import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  migrateDatabase,
  NodraSqliteDatabase,
  SqliteHealthProbe,
  SqliteMissionRepository
} from "@nodra/adapters";
import { CreateMission, GetHealth } from "@nodra/application";
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
    const cli = new NodraCli(
      new GetHealth(new SqliteHealthProbe(database)),
      new CreateMission(new SqliteMissionRepository(database)),
      new ConsoleOutput()
    );
    return await cli.run(arguments_);
  } finally {
    database.close();
  }
};
