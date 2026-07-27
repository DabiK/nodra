import { execFile } from "node:child_process";
import { access, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { ResolveWorktree, type WorkspaceRecord } from "@nodra/application";
import { asId } from "@nodra/domain";
import { LocalWorkspaceAdapter } from "./local-workspace-adapter.js";

const exec = promisify(execFile);

const exists = async (path: string) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

/** Minimal in-memory WorkspaceRepository sufficient for ResolveWorktree. */
function repositoryReturning(record: WorkspaceRecord) {
  return {
    read: async () => record
  } as unknown as ConstructorParameters<typeof ResolveWorktree>[0];
}

describe("LocalWorkspaceAdapter — worktree resolution lifecycle", () => {
  let root: string;
  let managedRoot: string;
  let repositoryPath: string;
  let adapter: LocalWorkspaceAdapter;
  let baseHead: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "nodra-worktree-")));
    managedRoot = join(root, "managed");
    repositoryPath = join(root, "repository");
    adapter = new LocalWorkspaceAdapter(managedRoot);
    await adapter.initialize();
    await exec("git", ["init", repositoryPath]);
    await exec("git", ["-C", repositoryPath, "config", "user.name", "Nodra Test"]);
    await exec("git", ["-C", repositoryPath, "config", "user.email", "nodra@example.test"]);
    // Keep the default branch off the task branch so branch deletion is allowed.
    await exec("git", ["-C", repositoryPath, "checkout", "-b", "main"]);
    await writeFile(join(repositoryPath, "tracked.txt"), "initial\n");
    await exec("git", ["-C", repositoryPath, "add", "tracked.txt"]);
    await exec("git", ["-C", repositoryPath, "commit", "-m", "initial"]);
    baseHead = (await exec("git", ["-C", repositoryPath, "rev-parse", "HEAD"])).stdout.trim();
  });

  const createWorktree = async (branchName: string, name = "wt") => {
    const worktree = await adapter.createWorktree({
      sourcePath: repositoryPath,
      requestedPath: join(managedRoot, name),
      branchName,
      baseRef: baseHead
    });
    return worktree.path;
  };

  const record = (path: string, branchName: string): WorkspaceRecord => ({
    id: asId("ws-1"),
    projectId: null,
    kind: "worktree",
    path,
    state: "ready",
    createdAt: new Date().toISOString(),
    tombstonedAt: null,
    repository: {
      id: asId("repo-1"),
      stableIdentity: "abc",
      canonicalRemote: null,
      baseRef: baseHead,
      headRef: baseHead,
      branchName,
      integrationTargetRef: null
    }
  });

  it("creates a worktree and reports a clean status", async () => {
    const path = await createWorktree("nodra/clean");
    const status = await adapter.inspectWorktree({ worktreePath: path, baseRef: baseHead, branchName: "nodra/clean" });
    expect(status).toMatchObject({
      mainRepositoryPath: repositoryPath,
      worktreeExists: true,
      branchExists: true,
      hasUncommittedChanges: false,
      hasUnmergedCommits: false
    });
  });

  it("detects uncommitted changes", async () => {
    const path = await createWorktree("nodra/dirty");
    await writeFile(join(path, "tracked.txt"), "changed\n");
    const status = await adapter.inspectWorktree({ worktreePath: path, baseRef: baseHead, branchName: "nodra/dirty" });
    expect(status.hasUncommittedChanges).toBe(true);
  });

  it("detects unmerged commits on the task branch", async () => {
    const path = await createWorktree("nodra/ahead");
    await writeFile(join(path, "tracked.txt"), "feature\n");
    await exec("git", ["-C", path, "commit", "-am", "feature work"]);
    const status = await adapter.inspectWorktree({ worktreePath: path, baseRef: baseHead, branchName: "nodra/ahead" });
    expect(status.hasUnmergedCommits).toBe(true);
  });

  describe("ResolveWorktree use-case", () => {
    it("Option A removes the worktree AND the branch (worktree first)", async () => {
      const path = await createWorktree("nodra/remove-all");
      const resolve = new ResolveWorktree(repositoryReturning(record(path, "nodra/remove-all")), adapter);
      const result = await resolve.execute({ workspaceId: asId("ws-1"), action: "remove-all" });
      expect(result).toMatchObject({ worktreeRemoved: true, branchDeleted: true, branchKept: false });
      expect(await exists(path)).toBe(false);
      const branches = (await exec("git", ["-C", repositoryPath, "branch", "--list", "nodra/remove-all"])).stdout.trim();
      expect(branches).toBe("");
    });

    it("Option B removes the worktree but KEEPS the branch", async () => {
      const path = await createWorktree("nodra/keep");
      const resolve = new ResolveWorktree(repositoryReturning(record(path, "nodra/keep")), adapter);
      const result = await resolve.execute({ workspaceId: asId("ws-1"), action: "keep-branch" });
      expect(result).toMatchObject({ worktreeRemoved: true, branchDeleted: false, branchKept: true, branchName: "nodra/keep" });
      expect(await exists(path)).toBe(false);
      const branches = (await exec("git", ["-C", repositoryPath, "branch", "--list", "nodra/keep"])).stdout.trim();
      expect(branches).toContain("nodra/keep");
    });

    it("refuses to discard uncommitted changes without confirmation, then succeeds with it", async () => {
      const path = await createWorktree("nodra/dirty-guard");
      await writeFile(join(path, "tracked.txt"), "wip\n");
      const resolve = new ResolveWorktree(repositoryReturning(record(path, "nodra/dirty-guard")), adapter);
      await expect(resolve.execute({ workspaceId: asId("ws-1"), action: "keep-branch" }))
        .rejects.toMatchObject({ code: "WORKTREE_UNCOMMITTED_CHANGES" });
      expect(await exists(path)).toBe(true);
      const forced = await resolve.execute({ workspaceId: asId("ws-1"), action: "keep-branch", confirmDiscardChanges: true });
      expect(forced.worktreeRemoved).toBe(true);
      expect(await exists(path)).toBe(false);
    });

    it("refuses to delete a branch with unmerged commits without confirmation, then succeeds with it", async () => {
      const path = await createWorktree("nodra/unmerged-guard");
      await writeFile(join(path, "tracked.txt"), "feature\n");
      await exec("git", ["-C", path, "commit", "-am", "feature work"]);
      const resolve = new ResolveWorktree(repositoryReturning(record(path, "nodra/unmerged-guard")), adapter);
      await expect(resolve.execute({ workspaceId: asId("ws-1"), action: "remove-all" }))
        .rejects.toMatchObject({ code: "WORKTREE_BRANCH_UNMERGED" });
      // Nothing destructive happened yet.
      expect(await exists(path)).toBe(true);
      const branches = (await exec("git", ["-C", repositoryPath, "branch", "--list", "nodra/unmerged-guard"])).stdout.trim();
      expect(branches).toContain("nodra/unmerged-guard");
      const forced = await resolve.execute({ workspaceId: asId("ws-1"), action: "remove-all", confirmDeleteUnmerged: true });
      expect(forced).toMatchObject({ worktreeRemoved: true, branchDeleted: true });
      expect(await exists(path)).toBe(false);
    });

    it("cannot run two resolutions simultaneously", async () => {
      const path = await createWorktree("nodra/concurrent");
      const resolve = new ResolveWorktree(repositoryReturning(record(path, "nodra/concurrent")), adapter);
      const [first, second] = await Promise.allSettled([
        resolve.execute({ workspaceId: asId("ws-1"), action: "keep-branch" }),
        resolve.execute({ workspaceId: asId("ws-1"), action: "keep-branch" })
      ]);
      const outcomes = [first.status, second.status].sort();
      expect(outcomes).toEqual(["fulfilled", "rejected"]);
      const rejected = (first.status === "rejected" ? first : second) as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ code: "WORKTREE_RESOLUTION_IN_PROGRESS" });
    });

    it("rejects resolution for a non-worktree workspace", async () => {
      const nonWorktree = { ...record(repositoryPath, "main"), kind: "repo" as const };
      const resolve = new ResolveWorktree(repositoryReturning(nonWorktree), adapter);
      await expect(resolve.execute({ workspaceId: asId("ws-1"), action: "keep-branch" }))
        .rejects.toMatchObject({ code: "REQUEST_INVALID" });
    });
  });

  describe("manual deletion / idempotency (real git)", () => {
    it("removeWorktree prunes a manually deleted worktree directory", async () => {
      const path = await createWorktree("nodra/manual-dir");
      await rm(path, { recursive: true, force: true });
      // Idempotent: does not throw even though the directory is gone.
      await adapter.removeWorktree({ mainRepositoryPath: repositoryPath, worktreePath: path, force: true });
      const list = (await exec("git", ["-C", repositoryPath, "worktree", "list", "--porcelain"])).stdout;
      expect(list).not.toContain(path);
    });

    it("deleteWorktreeBranch is idempotent when the branch was already removed", async () => {
      await createWorktree("nodra/manual-branch");
      // Remove worktree then delete the branch twice.
      await adapter.removeWorktree({ mainRepositoryPath: repositoryPath, worktreePath: join(managedRoot, "wt"), force: true });
      await adapter.deleteWorktreeBranch({ mainRepositoryPath: repositoryPath, branchName: "nodra/manual-branch", force: false });
      await expect(adapter.deleteWorktreeBranch({ mainRepositoryPath: repositoryPath, branchName: "nodra/manual-branch", force: false }))
        .resolves.toBeUndefined();
    });

    it("surfaces a git error when removing from a non-existent main repository", async () => {
      const path = await createWorktree("nodra/bad-main");
      await expect(adapter.removeWorktree({ mainRepositoryPath: join(root, "nope"), worktreePath: path, force: false }))
        .rejects.toMatchObject({ code: "WORKSPACE_PATH_CONFLICT" });
    });

    it("surfaces a git error when deleting a checked-out branch", async () => {
      await createWorktree("nodra/checkout-guard");
      // 'main' is checked out in the main repo → git refuses to delete it.
      await expect(adapter.deleteWorktreeBranch({ mainRepositoryPath: repositoryPath, branchName: "main", force: true }))
        .rejects.toMatchObject({ code: "GIT_OPERATION_FAILED" });
    });
  });
});
