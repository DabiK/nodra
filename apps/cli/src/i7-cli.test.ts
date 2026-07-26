import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  migrateDatabase,
  NodraSqliteDatabase,
  SqliteAgentConfigRepository,
  SqliteMissionRepository,
  SqliteProviderCatalogRepository
} from "@nodra/adapters";
import {
  CreateMission,
  EnableAgentConfig,
  GetAgentConfig,
  PreviewAgentConfig,
  type ProviderCapabilities,
  ResolveAgentConfig,
  UpdateAgentConfig,
  toId
} from "@nodra/application";
import { workspaces } from "../../../packages/adapters/src/sqlite/schema/core.js";
import { AgentConfigCli } from "./agent-config-cli.js";

describe("I7 agent config CLI", () => {
  let directory: string;
  let database: NodraSqliteDatabase;
  let cli: AgentConfigCli;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "nodra-i7-cli-"));
    database = NodraSqliteDatabase.open(join(directory, "nodra.db"));
    await migrateDatabase(database, resolve("packages/adapters/drizzle"));
    const missions = new SqliteMissionRepository(database);
    const configs = new SqliteAgentConfigRepository(database);
    const catalog = new SqliteProviderCatalogRepository(database);
    const resolver = new ResolveAgentConfig(configs, catalog);
    cli = new AgentConfigCli(
      new EnableAgentConfig(missions, configs),
      new GetAgentConfig(configs),
      new UpdateAgentConfig(configs),
      new PreviewAgentConfig(resolver)
    );
    await new CreateMission(missions).execute({
      id: toId("i7-cli-mission"),
      title: "CLI vertical",
      context: {
        commandId: toId("i7-cli-create"),
        actor: "user",
        occurredAt: "2026-07-26T12:00:00.000Z"
      }
    });
    database.orm.insert(workspaces).values({
      id: "i7-cli-workspace",
      projectId: null,
      kind: "scratch",
      path: join(directory, "workspace"),
      state: "ready",
      createdAt: "2026-07-26T12:00:00.000Z"
    }).run();
    const available = { available: true, reason: null };
    const capabilities: ProviderCapabilities = {
      schemaVersion: 1,
      providerId: "i6-2-deterministic",
      version: "i7-cli-fixture-v1",
      availability: available,
      authentication: available,
      models: available,
      contract: {
        ...available,
        status: "certified",
        expectedVersion: "i7-cli-fixture-v1",
        currentVersion: "i7-cli-fixture-v1",
        action: null
      },
      start: available,
      events: available,
      cancel: available,
      resume: available,
      steer: { ...available, mode: "immediate" },
      usage: { available: false, reason: "fixture", kind: "none" },
      attachments: { available: false, reason: "fixture" },
      mcp: { available: false, reason: "fixture" },
      permissionInterception: available,
      optionsSchemaVersion: 1
    };
    await catalog.save({
      providerId: "i6-2-deterministic",
      adapterVersion: "i7-cli-fixture-v1",
      binaryVersion: "fixture",
      authenticated: true,
      authKind: "fixture",
      health: { status: "ready", reason: null, actionRequired: null },
      capabilities,
      models: [{
        id: "fixture-model",
        displayName: "Fixture",
        description: "Fixture",
        hidden: false,
        isDefault: true,
        supportedReasoningEfforts: ["low"],
        defaultReasoningEffort: "low"
      }],
      probedAt: "2026-07-26T12:00:00.000Z"
    });
  });

  afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("drives enable, configure, show and pure preview without SQL commands", async () => {
    await expect(cli.execute("mission:agent-enable", ["i7-cli-mission", "0"]))
      .resolves.toMatchObject({ version: 0, providerId: null });
    await expect(cli.execute("mission:agent-config", [
      "i7-cli-mission",
      "0",
      "--provider",
      "i6-2-deterministic",
      "--model",
      "fixture-model",
      "--effort",
      "low",
      "--prompt",
      "CLI deterministic marker",
      "--permission",
      "read_only",
      "--workspace",
      "i7-cli-workspace"
    ])).resolves.toMatchObject({ version: 1, modelId: "fixture-model" });
    await expect(cli.execute("mission:agent-show", ["i7-cli-mission"]))
      .resolves.toMatchObject({ missionPrompt: "CLI deterministic marker" });
    const runsBefore = database.connection.prepare("select count(*) as count from run").get() as { count: number };
    const preview = await cli.execute("mission:agent-preview", ["i7-cli-mission"]) as {
      blockingErrors: unknown[];
      resolved: { cwd: string };
    };
    expect(preview.blockingErrors).toEqual([]);
    expect(preview.resolved.cwd).toBe(join(directory, "workspace"));
    expect(database.connection.prepare("select count(*) as count from run").get()).toEqual(runsBefore);
  });
});
