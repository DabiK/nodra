import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  migrateDatabase,
  NodraSqliteDatabase,
  SqliteHealthProbe,
  SqliteMissionReadModel,
  SqliteMissionRepository
} from "@nodra/adapters";
import { ChangeMissionState, CreateMission, GetHealth, GetRelay, ListMissions, ShowMission } from "@nodra/application";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodraCli, type CliOutput } from "./nodra-cli.js";

class MemoryOutput implements CliOutput {
  readonly values: string[] = [];

  write(value: string): void {
    this.values.push(value);
  }

  lastJson(): any {
    return JSON.parse(this.values.at(-1) ?? "null");
  }
}

describe("NodraCli", () => {
  let database: NodraSqliteDatabase;
  let output: MemoryOutput;
  let cli: NodraCli;

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-cli-"));
    database = NodraSqliteDatabase.open(join(directory, "nodra.db"));
    await migrateDatabase(database, resolve("packages/adapters/drizzle"));
    const repository = new SqliteMissionRepository(database);
    const readModel = new SqliteMissionReadModel(database);
    output = new MemoryOutput();
    cli = new NodraCli(
      new GetHealth(new SqliteHealthProbe(database)),
      new CreateMission(repository),
      new ChangeMissionState(repository),
      new ListMissions(readModel),
      new ShowMission(readModel),
      new GetRelay(readModel),
      output
    );
  });

  afterEach(() => database.close());

  it("runs the shared health use case", async () => {
    expect(await cli.run(["health"])).toBe(0);
    expect(output.lastJson()).toMatchObject({ service: "nodra", status: "ok" });
  });

  it("drives the primary human flow and exposes list, show and Relay", async () => {
    expect(await cli.run(["mission:create", "Préparer", "I2"])).toBe(0);
    const id = output.lastJson().id as string;
    expect(output.lastJson()).toMatchObject({ title: "Préparer I2", state: "DRAFT", version: 0 });

    expect(await cli.run(["mission:prepare", id, "0"])).toBe(0);
    expect(output.lastJson()).toMatchObject({ state: "READY", version: 1 });
    expect(await cli.run(["mission:pickup", id, "1"])).toBe(0);
    expect(output.lastJson()).toMatchObject({ state: "ACTIVE", version: 2 });
    expect(await cli.run(["mission:block", id, "2", "Waiting", "for", "review"])).toBe(0);
    expect(output.lastJson()).toMatchObject({ state: "BLOCKED", version: 3 });
    expect(await cli.run(["mission:resume", id, "3"])).toBe(0);
    expect(output.lastJson()).toMatchObject({ state: "READY", version: 4 });
    expect(await cli.run(["mission:close", id, "4"])).toBe(0);
    expect(output.lastJson()).toMatchObject({ state: "DONE", version: 5 });

    expect(await cli.run(["mission:list"])).toBe(0);
    expect(output.lastJson()).toEqual([expect.objectContaining({ id, state: "DONE" })]);
    expect(await cli.run(["mission:show", id])).toBe(0);
    expect(output.lastJson()).toMatchObject({ id, state: "DONE", executionKind: "human" });
    expect(await cli.run(["relay"])).toBe(0);
    expect(output.lastJson()).toEqual({ ready: [], active: [], blocked: [], decision_required: [] });
  });

  it("returns stable non-zero business and usage exits", async () => {
    await cli.run(["mission:create", "Conflict"]);
    const id = output.lastJson().id as string;
    await cli.run(["mission:prepare", id, "0"]);

    expect(await cli.run(["mission:close", id, "0"])).toBe(1);
    expect(output.lastJson()).toMatchObject({ code: "MISSION_VERSION_CONFLICT" });
    expect(await cli.run(["mission:block", id, "1"])).toBe(2);
  });
});
