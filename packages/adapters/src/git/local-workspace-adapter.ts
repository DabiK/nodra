import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  IntegrationMethod,
  RepositoryIdentity,
  WorkspaceGitSnapshot,
  WorkspacePort
} from "@nodra/application";
import { DomainError } from "@nodra/domain";

const execute = promisify(execFile);

export class LocalWorkspaceAdapter implements WorkspacePort {
  private managedRoot: string;

  constructor(managedRoot: string) {
    this.managedRoot = resolve(managedRoot);
  }

  async initialize(): Promise<void> {
    await mkdir(this.managedRoot, { recursive: true });
    this.managedRoot = await realpath(this.managedRoot);
  }

  canonicalizeExisting(path: string): Promise<string> {
    return this.real(path, "Workspace path does not exist");
  }

  async createScratch(requestedPath: string): Promise<string> {
    const target = await this.absentManagedTarget(requestedPath);
    try {
      await mkdir(target, { recursive: false });
      return await realpath(target);
    } catch {
      throw new DomainError("Workspace path already exists or cannot be created", "WORKSPACE_PATH_CONFLICT");
    }
  }

  async inspectRepository(requestedPath: string): Promise<RepositoryIdentity> {
    const requested = await this.real(requestedPath, "Repository path does not exist");
    const root = await this.git(requested, ["rev-parse", "--show-toplevel"]);
    const canonicalRoot = await realpath(root);
    if (canonicalRoot !== requested) {
      throw new DomainError("Requested path must be the repository root", "WORKSPACE_PATH_CONFLICT");
    }
    const commonDirectory = await this.git(canonicalRoot, ["rev-parse", "--git-common-dir"]);
    const canonicalCommonDirectory = await realpath(resolve(canonicalRoot, commonDirectory));
    const head = await this.git(canonicalRoot, ["rev-parse", "--verify", "HEAD"]);
    const branchName = await this.gitOptional(canonicalRoot, ["symbolic-ref", "--short", "-q", "HEAD"]);
    const canonicalRemote = await this.gitOptional(canonicalRoot, ["remote", "get-url", "origin"]);
    const stableSource = canonicalRemote
      ? `remote:${canonicalRemote}`
      : `gitdir:${canonicalCommonDirectory}`;
    return {
      stableIdentity: createHash("sha256").update(stableSource).digest("hex"),
      canonicalRemote,
      canonicalPath: canonicalRoot,
      head,
      branchName
    };
  }

  async createWorktree(input: {
    sourcePath: string;
    requestedPath: string;
    branchName: string;
    baseRef: string;
  }): Promise<{ path: string; repository: RepositoryIdentity }> {
    const source = await this.inspectRepository(input.sourcePath);
    const target = await this.absentManagedTarget(input.requestedPath);
    await this.git(source.canonicalPath, ["check-ref-format", "--branch", input.branchName]);
    await this.git(source.canonicalPath, ["rev-parse", "--verify", `${input.baseRef}^{commit}`]);
    try {
      await this.git(source.canonicalPath, [
        "worktree",
        "add",
        "-b",
        input.branchName,
        target,
        input.baseRef
      ]);
    } catch (error) {
      throw new DomainError(
        error instanceof Error ? error.message : "Worktree creation failed",
        "WORKSPACE_PATH_CONFLICT"
      );
    }
    const path = await realpath(target);
    return { path, repository: await this.inspectRepository(path) };
  }

  async snapshot(path: string): Promise<WorkspaceGitSnapshot> {
    const repository = await this.inspectRepository(path);
    const status = await this.git(repository.canonicalPath, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all"
    ]);
    const staged = await this.git(repository.canonicalPath, ["diff", "--binary", "--cached"]);
    const unstaged = await this.git(repository.canonicalPath, ["diff", "--binary"]);
    const treeDigest = createHash("sha256")
      .update(`${repository.head}\0${status}\0${staged}\0${unstaged}`)
      .digest("hex");
    const diffDigest = createHash("sha256")
      .update(`${status}\0${staged}\0${unstaged}`)
      .digest("hex");
    return {
      head: repository.head,
      treeDigest,
      diffDigest,
      branchName: repository.branchName,
      capturedAt: new Date().toISOString()
    };
  }

  async commit(input: { path: string; message: string }): Promise<void> {
    const repository = await this.inspectRepository(input.path);
    await this.git(repository.canonicalPath, ["add", "--all"]);
    await this.git(repository.canonicalPath, ["commit", "--message", input.message]);
  }

  async integrate(input: {
    path: string;
    method: IntegrationMethod;
    sourceRef: string;
    targetRef: string;
  }): Promise<void> {
    const repository = await this.inspectRepository(input.path);
    const target = await this.git(repository.canonicalPath, [
      "rev-parse",
      "--verify",
      `${input.targetRef}^{commit}`
    ]);
    if (target !== repository.head) {
      throw new DomainError("Workspace HEAD does not match the confirmed integration target", "CONFIRMATION_TARGET_MISMATCH");
    }
    await this.git(repository.canonicalPath, ["rev-parse", "--verify", `${input.sourceRef}^{commit}`]);
    const operation =
      input.method === "merge"
        ? ["merge", "--no-edit", input.sourceRef]
        : input.method === "rebase"
          ? ["rebase", input.sourceRef]
          : ["cherry-pick", input.sourceRef];
    await this.git(repository.canonicalPath, operation);
  }

  async deleteActivity(input: { path: string; kind: "scratch" | "worktree" }): Promise<void> {
    try {
      const canonical = await realpath(input.path);
      this.assertManaged(canonical);
      await access(canonical, constants.R_OK);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("Workspace path is unavailable for tombstoning", "WORKSPACE_STATE_CONFLICT");
    }
  }

  private async absentManagedTarget(requestedPath: string): Promise<string> {
    if (!isAbsolute(requestedPath)) {
      throw new DomainError("Managed workspace path must be absolute", "WORKSPACE_PATH_CONFLICT");
    }
    const requested = resolve(requestedPath);
    const parent = await this.real(dirname(requested), "Workspace parent path does not exist");
    const target = resolve(parent, basename(requested));
    this.assertManaged(target);
    this.assertManaged(parent, true);
    if (resolve(parent, target.slice(parent.length + 1)) !== target) {
      throw new DomainError("Workspace path escapes its canonical parent", "WORKSPACE_PATH_CONFLICT");
    }
    try {
      await lstat(target);
      throw new DomainError("Workspace path already exists", "WORKSPACE_PATH_CONFLICT");
    } catch (error) {
      if (error instanceof DomainError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
    return target;
  }

  private assertManaged(path: string, allowRoot = false): void {
    const pathFromRoot = relative(this.managedRoot, path);
    if ((!pathFromRoot && !allowRoot) || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
      throw new DomainError("Managed workspace path escapes the workspace root", "WORKSPACE_PATH_CONFLICT");
    }
  }

  private async real(path: string, message: string): Promise<string> {
    try {
      return await realpath(resolve(path));
    } catch {
      throw new DomainError(message, "WORKSPACE_PATH_CONFLICT");
    }
  }

  private async git(cwd: string, args: readonly string[]): Promise<string> {
    try {
      const result = await execute("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024
      });
      return result.stdout.trim();
    } catch (error) {
      const detail =
        error && typeof error === "object" && "stderr" in error
          ? String((error as { stderr?: unknown }).stderr).trim()
          : "Git operation failed";
      throw new DomainError(detail || "Git operation failed", "GIT_OPERATION_FAILED");
    }
  }

  private async gitOptional(cwd: string, args: readonly string[]): Promise<string | null> {
    try {
      return (await this.git(cwd, args)) || null;
    } catch {
      return null;
    }
  }
}
