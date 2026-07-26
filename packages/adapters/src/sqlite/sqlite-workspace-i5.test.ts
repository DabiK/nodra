import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  CommitWorkspace,
  CreateWorkspace,
  DeleteWorkspace,
  IntegrateWorkspace,
  ManageConfirmations,
  RestoreWorkspace,
  toId
} from "@nodra/application";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalWorkspaceAdapter } from "../git/local-workspace-adapter.js";
import { migrateDatabase } from "./migrate-database.js";
import { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { SqliteConfirmationRepository } from "./sqlite-confirmation-repository.js";
import { workspaceGitSnapshots } from "./schema/core.js";
import { missionAgentConfigs, missions } from "./schema/missions.js";
import { SqliteWorkspaceRepository } from "./sqlite-workspace-repository.js";

const exec = promisify(execFile);

describe("I5 SQLite workspace use cases", () => {
  let root: string;
  let database: NodraSqliteDatabase;
  let adapter: LocalWorkspaceAdapter;
  let repository: SqliteWorkspaceRepository;
  let confirmations: ManageConfirmations;
  const at = (commandId: string, occurredAt = "2026-07-26T10:00:00.000Z") => ({
    commandId: toId(commandId),
    actor: "user" as const,
    occurredAt
  });

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "nodra-i5-workspace-")));
    database = NodraSqliteDatabase.open(join(root, "nodra.db"));
    await migrateDatabase(database, resolve("packages/adapters/drizzle"));
    adapter = new LocalWorkspaceAdapter(join(root, "managed"));
    await adapter.initialize();
    repository = new SqliteWorkspaceRepository(database);
    confirmations = new ManageConfirmations(
      new SqliteConfirmationRepository(database),
      adapter
    );
  });

  afterEach(() => database.close());

  it("requires exact confirmation for commit unless mission auto-commit is authorized", async () => {
    const repositoryPath = join(root, "repository");
    await exec("git", ["init", repositoryPath]);
    await exec("git", ["-C", repositoryPath, "config", "user.name", "Nodra Test"]);
    await exec("git", ["-C", repositoryPath, "config", "user.email", "nodra@example.test"]);
    await writeFile(join(repositoryPath, "tracked.txt"), "initial\n");
    await exec("git", ["-C", repositoryPath, "add", "tracked.txt"]);
    await exec("git", ["-C", repositoryPath, "commit", "-m", "initial"]);
    await new CreateWorkspace(repository, adapter).execute({
      id: toId("repo-workspace"),
      kind: "repo",
      path: repositoryPath,
      context: at("create-repo")
    });
    database.orm.insert(missions).values({
      id: "mission-commit",
      projectId: null,
      title: "Commit safely",
      executionKind: "agent",
      state: "READY",
      version: 0,
      createdAt: at("seed").occurredAt,
      updatedAt: at("seed").occurredAt
    }).run();
    database.orm.insert(missionAgentConfigs).values({
      missionId: "mission-commit",
      providerOptionsJson: "{}",
      missionPrompt: "",
      workspaceId: "repo-workspace",
      autoCommitAuthorized: 0,
      updatedAt: at("seed").occurredAt
    }).run();
    await writeFile(join(repositoryPath, "tracked.txt"), "confirmed\n");
    const commits = new CommitWorkspace(repository, adapter, confirmations);
    await expect(commits.execute({
      workspaceId: toId("repo-workspace"),
      missionId: toId("mission-commit"),
      message: "confirmed commit",
      context: at("commit-without-confirmation")
    })).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect((await adapter.snapshot(repositoryPath)).head).toBe(
      (await repository.read(toId("repo-workspace"))).repository?.headRef
    );

    const target = {
      message: "confirmed commit",
      missionId: "mission-commit",
      workspaceId: "repo-workspace"
    };
    await confirmations.request({
      id: toId("commit-confirmation"),
      action: "git.commit",
      target,
      cwd: repositoryPath,
      risk: "write",
      scope: "mission",
      missionId: toId("mission-commit"),
      expiresAt: "2026-07-26T10:05:00.000Z",
      context: at("request-commit")
    });
    await confirmations.decide({
      id: toId("commit-confirmation"),
      decision: "approved",
      actor: "human",
      comment: "reviewed",
      context: at("decide-commit")
    });
    const result = await commits.execute({
      workspaceId: toId("repo-workspace"),
      missionId: toId("mission-commit"),
      message: "confirmed commit",
      confirmationId: toId("commit-confirmation"),
      context: at("commit-confirmed")
    });
    expect(result.after?.head).not.toBe(result.before?.head);
    expect(database.orm.select().from(workspaceGitSnapshots).all()).toHaveLength(3);

    database.connection.prepare(
      "update mission_agent_config set auto_commit_authorized=1 where mission_id='mission-commit'"
    ).run();
    await writeFile(join(repositoryPath, "tracked.txt"), "automatic\n");
    const automatic = await commits.execute({
      workspaceId: toId("repo-workspace"),
      missionId: toId("mission-commit"),
      message: "authorized auto commit",
      context: at("commit-auto")
    });
    expect(automatic).toMatchObject({ workspace: { id: "repo-workspace" } });
    const replay = await commits.execute({
      workspaceId: toId("repo-workspace"),
      missionId: toId("mission-commit"),
      message: "authorized auto commit",
      context: at("commit-auto")
    });
    expect(replay.workspace.repository?.headRef).toBe(automatic.after?.head);
  });

  it("blocks active runs, tombstones idempotently without deleting files, and restores explicitly", async () => {
    const scratchPath = join(root, "managed", "scratch");
    const workspace = await new CreateWorkspace(repository, adapter).execute({
      id: toId("scratch-workspace"),
      kind: "scratch",
      path: scratchPath,
      context: at("create-scratch")
    });
    await writeFile(join(workspace.path, "preserved.txt"), "preserved");
    const deletion = new DeleteWorkspace(repository, adapter, confirmations);

    database.connection.exec(`
      insert into mission(id,project_id,title,execution_kind,state,version,created_at,updated_at)
      values('mission-active',null,'Active','agent','ACTIVE',0,'${at("seed").occurredAt}','${at("seed").occurredAt}');
      insert into conversation(id,mission_id,manager_id,provider_id,state,created_at)
      values('conversation-active','mission-active',null,'none','open','${at("seed").occurredAt}');
      insert into run(id,mission_id,manager_id,conversation_id,user_attempt,state,temporal_workflow_id,provider_id,model_id,created_at)
      values('run-active','mission-active',null,'conversation-active',1,'RUNNING','run/run-active','none','none','${at("seed").occurredAt}');
      insert into run_config_snapshot(
        run_id,resolution_schema_version,provider_id_requested,provider_id_resolved,
        model_id_requested,model_id_resolved,provider_options_schema_version,
        provider_options_json,provider_capabilities_json,prompt_kind,
        prompt_composition_schema_version,prompt_effective,permission_preset,
        budget_snapshot_json,workspace_id,cwd,created_at
      ) values(
        'run-active',1,'none','none','none','none',1,'{}','{}','mission',1,'',
        'read_only','{}','scratch-workspace','${scratchPath}','${at("seed").occurredAt}'
      );
    `);
    await expect(deletion.execute({
      workspaceId: toId("scratch-workspace"),
      context: at("delete-active")
    })).rejects.toMatchObject({ code: "WORKSPACE_ACTIVE_RUN" });
    database.connection.prepare("update run set state='SUCCEEDED' where id='run-active'").run();

    const target = { path: scratchPath, workspaceId: "scratch-workspace" };
    await confirmations.request({
      id: toId("delete-confirmation"),
      action: "workspace.delete",
      target,
      cwd: scratchPath,
      risk: "destructive",
      scope: "once",
      workspaceId: toId("scratch-workspace"),
      expiresAt: "2026-07-26T10:05:00.000Z",
      context: at("request-delete")
    });
    await confirmations.decide({
      id: toId("delete-confirmation"),
      decision: "approved",
      actor: "human",
      comment: "reviewed",
      context: at("decide-delete")
    });
    const deleted = await deletion.execute({
      workspaceId: toId("scratch-workspace"),
      confirmationId: toId("delete-confirmation"),
      context: at("delete")
    });
    expect(deleted.state).toBe("deleted");
    expect(await readFile(join(scratchPath, "preserved.txt"), "utf8")).toBe("preserved");
    expect(await deletion.execute({
      workspaceId: toId("scratch-workspace"),
      confirmationId: toId("delete-confirmation"),
      context: at("delete")
    })).toMatchObject({ state: "deleted" });
    expect(await new RestoreWorkspace(repository, adapter).execute({
      workspaceId: toId("scratch-workspace"),
      context: at("restore")
    })).toMatchObject({ state: "ready", tombstonedAt: null });
  });

  it("integrates only the exact confirmed refs and stores snapshots before and after", async () => {
    const repositoryPath = join(root, "integration-repository");
    await exec("git", ["init", repositoryPath]);
    await exec("git", ["-C", repositoryPath, "config", "user.name", "Nodra Test"]);
    await exec("git", ["-C", repositoryPath, "config", "user.email", "nodra@example.test"]);
    await writeFile(join(repositoryPath, "tracked.txt"), "base\n");
    await exec("git", ["-C", repositoryPath, "add", "tracked.txt"]);
    await exec("git", ["-C", repositoryPath, "commit", "-m", "base"]);
    const create = new CreateWorkspace(repository, adapter);
    const base = await create.execute({
      id: toId("integration-base"),
      kind: "repo",
      path: repositoryPath,
      context: at("create-integration-base")
    });
    const baseHead = base.repository?.headRef;
    if (!baseHead) throw new Error("Expected base HEAD");
    const feature = await create.execute({
      id: toId("integration-feature"),
      kind: "worktree",
      path: join(root, "managed", "feature"),
      sourceWorkspaceId: toId("integration-base"),
      baseRef: baseHead,
      branchName: "nodra/i5-feature",
      context: at("create-integration-feature")
    });
    await writeFile(join(feature.path, "feature.txt"), "feature\n");
    await exec("git", ["-C", feature.path, "add", "feature.txt"]);
    await exec("git", ["-C", feature.path, "commit", "-m", "feature"]);

    const target = {
      method: "merge",
      sourceRef: "nodra/i5-feature",
      targetRef: baseHead,
      workspaceId: "integration-base"
    };
    await confirmations.request({
      id: toId("integrate-confirmation"),
      action: "git.integrate",
      target,
      cwd: repositoryPath,
      risk: "destructive",
      scope: "once",
      workspaceId: toId("integration-base"),
      expiresAt: "2026-07-26T10:05:00.000Z",
      context: at("request-integrate")
    });
    await confirmations.decide({
      id: toId("integrate-confirmation"),
      decision: "approved",
      actor: "human",
      comment: "reviewed",
      context: at("decide-integrate")
    });
    const integrated = await new IntegrateWorkspace(
      repository,
      adapter,
      confirmations
    ).execute({
      workspaceId: toId("integration-base"),
      method: "merge",
      sourceRef: "nodra/i5-feature",
      targetRef: baseHead,
      confirmationId: toId("integrate-confirmation"),
      context: at("integrate")
    });
    expect(integrated.before?.head).toBe(baseHead);
    expect(integrated.after?.head).not.toBe(baseHead);
    expect(await readFile(join(repositoryPath, "feature.txt"), "utf8")).toBe("feature\n");
    const remotes = await exec("git", ["-C", repositoryPath, "remote"]);
    expect(remotes.stdout.trim()).toBe("");
  });
});
