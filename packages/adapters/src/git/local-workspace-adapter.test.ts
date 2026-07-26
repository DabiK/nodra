import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalWorkspaceAdapter } from "./local-workspace-adapter.js";

const exec = promisify(execFile);

describe("LocalWorkspaceAdapter", () => {
  let root: string;
  let managedRoot: string;
  let repositoryPath: string;
  let adapter: LocalWorkspaceAdapter;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "nodra-i5-git-")));
    managedRoot = join(root, "managed");
    repositoryPath = join(root, "repository");
    adapter = new LocalWorkspaceAdapter(managedRoot);
    await adapter.initialize();
    await exec("git", ["init", repositoryPath]);
    await exec("git", ["-C", repositoryPath, "config", "user.name", "Nodra Test"]);
    await exec("git", ["-C", repositoryPath, "config", "user.email", "nodra@example.test"]);
    await writeFile(join(repositoryPath, "tracked.txt"), "initial\n");
    await exec("git", ["-C", repositoryPath, "add", "tracked.txt"]);
    await exec("git", ["-C", repositoryPath, "commit", "-m", "initial"]);
  });

  afterEach(() => undefined);

  it("creates exclusive scratch and isolated worktree paths with canonical snapshots", async () => {
    const scratch = join(managedRoot, "scratch");
    expect(await adapter.createScratch(scratch)).toBe(scratch);
    await writeFile(join(scratch, "keep.txt"), "keep");
    await expect(adapter.createScratch(scratch)).rejects.toMatchObject({
      code: "WORKSPACE_PATH_CONFLICT"
    });
    expect(await readFile(join(scratch, "keep.txt"), "utf8")).toBe("keep");

    const repository = await adapter.inspectRepository(repositoryPath);
    const worktreePath = join(managedRoot, "worktree");
    const worktree = await adapter.createWorktree({
      sourcePath: repositoryPath,
      requestedPath: worktreePath,
      branchName: "nodra/i5-test",
      baseRef: repository.head
    });
    expect(worktree.path).toBe(worktreePath);
    expect(worktree.repository.stableIdentity).toBe(repository.stableIdentity);
    const snapshot = await adapter.snapshot(worktree.path);
    expect(snapshot).toMatchObject({
      head: repository.head,
      branchName: "nodra/i5-test"
    });
    expect(snapshot.treeDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses traversal, symlink escape, subdirectory repositories and existing targets", async () => {
    await expect(adapter.createScratch(join(managedRoot, "..", "escape"))).rejects.toMatchObject({
      code: "WORKSPACE_PATH_CONFLICT"
    });
    const outside = join(root, "outside");
    await exec("mkdir", [outside]);
    await symlink(outside, join(managedRoot, "link"));
    await expect(adapter.createScratch(join(managedRoot, "link", "escape"))).rejects.toMatchObject({
      code: "WORKSPACE_PATH_CONFLICT"
    });
    await expect(adapter.inspectRepository(join(repositoryPath, ".git", ".."))).resolves.toMatchObject({
      canonicalPath: repositoryPath
    });
    await exec("mkdir", [join(repositoryPath, "subdirectory")]);
    await expect(adapter.inspectRepository(join(repositoryPath, "subdirectory"))).rejects.toMatchObject({
      code: "WORKSPACE_PATH_CONFLICT"
    });
    await writeFile(join(managedRoot, "occupied"), "do not overwrite");
    await expect(adapter.createScratch(join(managedRoot, "occupied"))).rejects.toMatchObject({
      code: "WORKSPACE_PATH_CONFLICT"
    });
  });

  it("commits only when called and never removes a workspace during delete activity", async () => {
    const repository = await adapter.inspectRepository(repositoryPath);
    const worktree = await adapter.createWorktree({
      sourcePath: repositoryPath,
      requestedPath: join(managedRoot, "commit-worktree"),
      branchName: "nodra/i5-commit",
      baseRef: repository.head
    });
    await writeFile(join(worktree.path, "tracked.txt"), "changed\n");
    const before = await adapter.snapshot(worktree.path);
    await adapter.commit({ path: worktree.path, message: "safe commit" });
    const after = await adapter.snapshot(worktree.path);
    expect(after.head).not.toBe(before.head);
    await adapter.deleteActivity({ path: worktree.path, kind: "worktree" });
    expect(await readFile(join(worktree.path, "tracked.txt"), "utf8")).toBe("changed\n");
  });
});
