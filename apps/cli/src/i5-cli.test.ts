import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  LocalWorkspaceAdapter,
  migrateDatabase,
  NodraSqliteDatabase,
  SqliteConfirmationRepository,
  SqliteWorkspaceDeletionReservation,
  SqliteWorkspaceRepository
} from "@nodra/adapters";
import {
  CommitWorkspace,
  CreateWorkspace,
  DeleteWorkspace,
  IntegrateWorkspace,
  ManageConfirmations,
  ReadWorkspace,
  RestoreWorkspace,
  SnapshotWorkspace
} from "@nodra/application";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfirmationCli } from "./confirmation-cli.js";
import { I4Cli } from "./i4-cli.js";
import { WorkspaceCli } from "./workspace-cli.js";

describe("I5 CLI", () => {
  let database: NodraSqliteDatabase;
  let cli: I4Cli;
  let root: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "nodra-i5-cli-")));
    database = NodraSqliteDatabase.open(join(root, "nodra.db"));
    await migrateDatabase(database, resolve("packages/adapters/drizzle"));
    const adapter = new LocalWorkspaceAdapter(join(root, "managed"));
    await adapter.initialize();
    const repository = new SqliteWorkspaceRepository(database);
    const confirmations = new ManageConfirmations(
      new SqliteConfirmationRepository(database),
      adapter
    );
    cli = new I4Cli([
      new ConfirmationCli(confirmations),
      new WorkspaceCli(
        new CreateWorkspace(repository, adapter),
        new ReadWorkspace(repository),
        new SnapshotWorkspace(repository, adapter),
        new CommitWorkspace(repository, adapter, confirmations),
        new IntegrateWorkspace(repository, adapter, confirmations),
        new DeleteWorkspace(
          repository,
          adapter,
          new SqliteWorkspaceDeletionReservation(database)
        ),
        new RestoreWorkspace(repository, adapter)
      )
    ]);
  });

  afterEach(() => database.close());

  it("drives workspace and exact confirmation commands through shared use cases", async () => {
    const path = join(root, "managed", "scratch");
    const created = await cli.execute("workspace:create", [
      "scratch",
      path,
      "--id",
      "cli-scratch",
      "--command-id",
      "cli-create"
    ]);
    expect(created).toMatchObject({ id: "cli-scratch", state: "ready" });

    const confirmation = await cli.execute("confirmation:request", [
      "workspace.delete",
      "destructive",
      "once",
      "workspace",
      "cli-scratch",
      new Date(Date.now() + 60_000).toISOString(),
      JSON.stringify({ path, workspaceId: "cli-scratch" }),
      "--cwd",
      path,
      "--command-id",
      "cli-request"
    ]) as { id: string };
    await expect(cli.execute("confirmation:decide", [
      confirmation.id,
      "approved",
      "human",
      "reviewed",
      "--command-id",
      "cli-decide"
    ])).resolves.toMatchObject({ state: "approved" });
    await expect(cli.execute("workspace:delete", [
      "cli-scratch",
      "--confirmation",
      confirmation.id,
      "--command-id",
      "cli-delete"
    ])).resolves.toMatchObject({ state: "deleted" });
    await expect(cli.execute("workspace:restore", [
      "cli-scratch",
      "--command-id",
      "cli-restore"
    ])).resolves.toMatchObject({ state: "ready" });
  });

  it("rejects invalid flags without invoking an operation", async () => {
    await expect(cli.execute("workspace:create", [
      "scratch",
      join(root, "managed", "scratch"),
      "--unknown",
      "value"
    ])).rejects.toMatchObject({ code: "CLI_USAGE_ERROR" });
  });
});
