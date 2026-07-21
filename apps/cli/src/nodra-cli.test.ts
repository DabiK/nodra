import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  migrateDatabase,
  NodraSqliteDatabase,
  SqliteHealthProbe,
  SqliteMissionReadModel,
  SqliteMissionRepository,
  SqliteMissionExecutionRepository,
  SqliteWorkflowOutboxStore,
  SqliteWorkflowReconciliationStore,
  UnavailableWorkflowAdapter
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
  StartMission,
  toId
} from "@nodra/application";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { NodraCli, type CliOutput } from "./nodra-cli.js";
import { workspaces } from "../../../packages/adapters/src/sqlite/schema/core.js";
import { missionAgentConfigs, missions } from "../../../packages/adapters/src/sqlite/schema/missions.js";
import { outbox } from "../../../packages/adapters/src/sqlite/schema/operations.js";
import { runs } from "../../../packages/adapters/src/sqlite/schema/runs.js";

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
      new GetHealth(new SqliteHealthProbe(database), { check: async () => ({ status: "ok" }) }),
      new CreateMission(repository),
      new ChangeMissionState(repository),
      new ListMissions(readModel),
      new ShowMission(readModel),
      new GetRelay(readModel),
      new StartMission(repository, new SqliteMissionExecutionRepository(database), {
        check: async () => ({ status: "ok" })
      }),
      new DispatchWorkflowOutbox(new SqliteWorkflowOutboxStore(database), new UnavailableWorkflowAdapter()),
      new ReconcileWorkflows(new SqliteWorkflowReconciliationStore(database), new UnavailableWorkflowAdapter()),
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

  it("returns stable JSON without stack traces for missing projects and duplicate commands", async () => {
    expect(await cli.run(["mission:create", "--project", "project-missing", "Missing", "project"])).toBe(1);
    expect(output.lastJson()).toMatchObject({ code: "PROJECT_NOT_FOUND" });
    expect(output.values.at(-1)).not.toMatch(/SqliteError|SQLITE_CONSTRAINT|\n\s+at /);

    expect(await cli.run(["mission:create", "--command-id", "cli-duplicate", "First"])).toBe(0);
    expect(await cli.run(["mission:create", "--command-id", "cli-duplicate", "Second"])).toBe(1);
    expect(output.lastJson()).toMatchObject({ code: "COMMAND_ID_CONFLICT" });
    expect(output.values.at(-1)).not.toMatch(/SqliteError|SQLITE_CONSTRAINT|\n\s+at /);
  });

  it("returns a stable non-zero error for agent start when runtime health is down", async () => {
    const time = "2026-07-22T12:00:00.000Z";
    database.orm.insert(workspaces).values({
      id: "workspace-cli-agent",
      projectId: null,
      kind: "scratch",
      path: join(tmpdir(), "workspace-cli-agent"),
      state: "ready",
      createdAt: time
    }).run();
    database.orm.insert(missions).values({
      id: "cli-agent",
      projectId: null,
      title: "CLI agent",
      executionKind: "agent",
      state: "READY",
      version: 1,
      createdAt: time,
      updatedAt: time
    }).run();
    database.orm.insert(missionAgentConfigs).values({
      missionId: "cli-agent",
      providerId: "configured-not-called",
      modelId: "configured-not-called",
      providerOptionsJson: "{}",
      missionPrompt: "No provider",
      permissionPreset: "read_only",
      workspaceId: "workspace-cli-agent",
      updatedAt: time
    }).run();
    const repository = new SqliteMissionRepository(database);
    const readModel = new SqliteMissionReadModel(database);
    const unavailableCli = new NodraCli(
      new GetHealth(new SqliteHealthProbe(database), { check: async () => ({ status: "error" }) }),
      new CreateMission(repository),
      new ChangeMissionState(repository),
      new ListMissions(readModel),
      new ShowMission(readModel),
      new GetRelay(readModel),
      new StartMission(repository, new SqliteMissionExecutionRepository(database), {
        check: async () => ({ status: "error" })
      }),
      new DispatchWorkflowOutbox(new SqliteWorkflowOutboxStore(database), new UnavailableWorkflowAdapter()),
      new ReconcileWorkflows(new SqliteWorkflowReconciliationStore(database), new UnavailableWorkflowAdapter()),
      output
    );
    expect(await unavailableCli.run(["mission:start", "cli-agent", "1", "--command-id", "cli-unhealthy"]))
      .toBe(1);
    expect(output.lastJson()).toMatchObject({ code: "RUNTIME_UNHEALTHY" });
    expect(database.orm.select().from(runs).all()).toHaveLength(0);

    await new StartMission(repository, new SqliteMissionExecutionRepository(database), {
      check: async () => ({ status: "ok" })
    }).execute({
      missionId: toId("cli-agent"),
      expectedVersion: 1,
      runId: toId("run-cli-agent"),
      conversationId: toId("conversation-cli-agent"),
      auditId: toId("audit-cli-dispatch"),
      outboxId: toId("outbox-cli-dispatch"),
      context: { commandId: toId("cli-dispatch"), actor: "user", occurredAt: time }
    });
    expect(await unavailableCli.run(["temporal:dispatch"])).toBe(1);
    expect(output.lastJson()).toMatchObject({ code: "RUNTIME_UNHEALTHY" });
    expect(database.orm.select().from(outbox).where(eq(outbox.id, "outbox-cli-dispatch")).get()?.publishedAt)
      .toBeNull();
    expect(await unavailableCli.run(["temporal:reconcile"])).toBe(1);
    expect(output.lastJson()).toMatchObject({ code: "RUNTIME_UNHEALTHY" });
  });
});
