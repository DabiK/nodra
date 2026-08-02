import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdir, realpath, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  IntegrationMethod,
  RepositoryIdentity,
  WorkspaceDiff,
  WorkspaceDiffFile,
  WorkspaceGitSnapshot,
  WorkspacePort,
  WorktreeStatus
} from "@nodra/application";
import { DomainError } from "@nodra/domain";

const execute = promisify(execFile);

/** Taille maximale d'un fichier non suivi embarqué dans le diff (le reste est tronqué). */
const MAX_UNTRACKED_DIFF_BYTES = 1024 * 1024;

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

  async diff(input: { path: string; base: string | null; head: string | null }): Promise<WorkspaceDiff> {
    const repository = await this.inspectRepository(input.path);
    const cwd = repository.canonicalPath;
    const base = input.base ?? repository.head;
    const head = input.head;
    const range = head ? [base, head] : [base];

    const [nameStatus, numstat, fullDiff] = await Promise.all([
      this.git(cwd, ["diff", "--no-ext-diff", "--find-renames", "--name-status", ...range]),
      this.git(cwd, ["diff", "--numstat", ...range]),
      this.git(cwd, ["diff", "--no-ext-diff", "--unified=3", ...range])
    ]);

    const contentByPath = splitUnifiedDiff(fullDiff);
    const countsByPath = new Map(parseNumstat(numstat));
    const files: WorkspaceDiffFile[] = parseNameStatus(nameStatus).map((entry) => {
      const counts = countsByPath.get(entry.path) ?? null;
      const content = contentByPath.get(entry.path) ?? (entry.oldPath ? contentByPath.get(entry.oldPath) : undefined) ?? "";
      return {
        path: entry.path,
        oldPath: entry.oldPath,
        status: entry.status,
        additions: counts?.additions ?? null,
        deletions: counts?.deletions ?? null,
        content
      };
    });

    // Comparaison avec l'arbre de travail : les fichiers non suivis n'apparaissent
    // dans aucun `git diff` — on les liste via `status --porcelain` et on fabrique
    // un diff synthétique (ajout complet).
    if (!head) {
      const status = (await this.gitOptional(cwd, ["status", "--porcelain=v1", "--untracked-files=all"])) ?? "";
      for (const line of status.split("\n")) {
        if (!line.startsWith("?? ")) continue;
        const untrackedPath = decodeGitPath(line.slice(3));
        const absolute = resolve(cwd, untrackedPath);
        let content = "";
        let lineCount = 0;
        try {
          const raw = await readFile(absolute, "utf8");
          const truncated = raw.length > MAX_UNTRACKED_DIFF_BYTES;
          const body = truncated ? raw.slice(0, MAX_UNTRACKED_DIFF_BYTES) : raw;
          const lines = body.split("\n");
          // La ligne vide terminale (saut de ligne final) n'est pas un contenu.
          if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
          lineCount = lines.length;
          content = [
            `diff --git a/${untrackedPath} b/${untrackedPath}`,
            "new file mode 100644",
            "--- /dev/null",
            `+++ b/${untrackedPath}`,
            `@@ -0,0 +1,${lineCount} @@`,
            ...lines.map((line) => `+${line}`),
            truncated ? "+… (diff tronqué)" : ""
          ].join("\n");
        } catch {
          // Fichier illisible (supprimé entre le status et la lecture) : ignoré.
        }
        files.push({
          path: untrackedPath,
          oldPath: null,
          status: "added",
          additions: lineCount,
          deletions: 0,
          content
        });
      }
    }

    return { base, head, files };
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

  async inspectWorktree(input: {
    worktreePath: string;
    baseRef: string | null;
    branchName: string | null;
  }): Promise<WorktreeStatus> {
    let mainRepositoryPath: string | null = null;
    let worktreeExists = false;
    let head: string | null = null;
    let hasUncommittedChanges = false;
    let canonicalWorktree: string | null = null;

    try {
      canonicalWorktree = await realpath(input.worktreePath);
      // The common dir of a linked worktree points at the main repo's `.git`.
      const commonDir = await this.git(canonicalWorktree, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
      mainRepositoryPath = await realpath(dirname(commonDir));
      worktreeExists = true;
      head = await this.gitOptional(canonicalWorktree, ["rev-parse", "--verify", "HEAD"]);
      const status = await this.git(canonicalWorktree, ["status", "--porcelain", "--untracked-files=all"]);
      hasUncommittedChanges = status.trim().length > 0;
    } catch {
      worktreeExists = false;
    }

    let branchExists = false;
    let hasUnmergedCommits = false;
    if (mainRepositoryPath && input.branchName) {
      const branchRef = `refs/heads/${input.branchName}`;
      branchExists = (await this.gitOptional(mainRepositoryPath, ["rev-parse", "--verify", "--quiet", branchRef])) !== null;
      if (branchExists) {
        if (input.baseRef && (await this.gitOptional(mainRepositoryPath, ["rev-parse", "--verify", `${input.baseRef}^{commit}`]))) {
          const ahead = await this.gitOptional(mainRepositoryPath, ["rev-list", "--count", `${input.baseRef}..${branchRef}`]);
          hasUnmergedCommits = ahead !== null && Number.parseInt(ahead, 10) > 0;
        } else {
          // Base ref cannot be verified: assume the branch may hold work (conservative).
          hasUnmergedCommits = true;
        }
      }
    }

    return {
      mainRepositoryPath,
      worktreeExists,
      branchExists,
      branchName: input.branchName,
      baseRef: input.baseRef,
      hasUncommittedChanges,
      hasUnmergedCommits,
      head
    };
  }

  async removeWorktree(input: {
    mainRepositoryPath: string;
    worktreePath: string;
    force: boolean;
  }): Promise<void> {
    const main = await this.real(input.mainRepositoryPath, "Main repository path does not exist");
    // `git worktree remove` refuses a dirty/locked worktree unless forced.
    const args = ["worktree", "remove", ...(input.force ? ["--force"] : []), input.worktreePath];
    try {
      await this.git(main, args);
    } catch (error) {
      // Idempotent: if the directory is already gone / no longer registered,
      // prune the stale administrative reference and treat it as removed.
      await this.gitOptional(main, ["worktree", "prune"]);
      const stillRegistered = await this.gitOptional(main, ["worktree", "list", "--porcelain"]);
      const target = resolve(input.worktreePath);
      if (stillRegistered && stillRegistered.split("\n").some((line) => line === `worktree ${target}` || line === `worktree ${input.worktreePath}`)) {
        throw new DomainError(
          error instanceof DomainError ? error.message : "Worktree removal failed",
          "GIT_OPERATION_FAILED"
        );
      }
      return;
    }
    await this.gitOptional(main, ["worktree", "prune"]);
  }

  async deleteWorktreeBranch(input: {
    mainRepositoryPath: string;
    branchName: string;
    force: boolean;
  }): Promise<void> {
    const main = await this.real(input.mainRepositoryPath, "Main repository path does not exist");
    const exists = (await this.gitOptional(main, ["rev-parse", "--verify", "--quiet", `refs/heads/${input.branchName}`])) !== null;
    if (!exists) return; // Idempotent: branch already deleted manually.
    await this.git(main, ["branch", input.force ? "-D" : "-d", input.branchName]);
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

interface NameStatusEntry {
  path: string;
  oldPath: string | null;
  status: WorkspaceDiffFile["status"];
}

/** Parse `git diff --name-status` : une ligne par fichier, `X\tpath` ou `X\told\tnew`. */
function parseNameStatus(output: string): NameStatusEntry[] {
  const entries: NameStatusEntry[] = [];
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const [code, ...rest] = line.split("\t");
    const status = nameStatusToStatus(code ?? "");
    const path = rest.length > 1 ? rest[rest.length - 1] ?? "" : rest[0] ?? "";
    const oldPath = rest.length > 1 ? rest[0] ?? null : null;
    if (!path) continue;
    entries.push({ path: decodeGitPath(path), oldPath: oldPath === null ? null : decodeGitPath(oldPath), status });
  }
  return entries;
}

function nameStatusToStatus(code: string): WorkspaceDiffFile["status"] {
  switch (code[0]) {
    case "A":
    case "C":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      // M, T (typechange), U (unmerged)… : traité comme modifié.
      return "modified";
  }
}

/** Parse `git diff --numstat` : `adds\tdels\tpath` (ou `-\t-\tpath` pour un binaire). */
function parseNumstat(output: string): Array<[string, { additions: number | null; deletions: number | null }]> {
  const rows: Array<[string, { additions: number | null; deletions: number | null }]> = [];
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const [adds, dels, ...rest] = line.split("\t");
    if (!rest.length) continue;
    const path = decodeGitPath(rest.join("\t"));
    const additions = adds === "-" ? null : Number.parseInt(adds ?? "", 10);
    const deletions = dels === "-" ? null : Number.parseInt(dels ?? "", 10);
    rows.push([path, { additions, deletions }]);
  }
  return rows;
}

/**
 * Découpe un `git diff` unifié complet en blocs par fichier, indexés par le
 * chemin de destination (`b/`), ou `a/` pour une suppression.
 */
function splitUnifiedDiff(output: string): Map<string, string> {
  const blocks = new Map<string, string>();
  if (!output.trim()) return blocks;
  const chunks = output.split("\ndiff --git ");
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index] ?? "";
    const headerLine = index === 0 ? chunk : `diff --git ${chunk}`;
    const firstLineEnd = headerLine.indexOf("\n");
    const header = (firstLineEnd === -1 ? headerLine : headerLine.slice(0, firstLineEnd)).trim();
    if (!header.startsWith("diff --git ")) continue;
    const { aPath, bPath } = headerPaths(header);
    const key = bPath === "/dev/null" ? aPath : bPath;
    blocks.set(key, headerLine.replace(/\n$/, ""));
  }
  return blocks;
}

/** Extrait les chemins a/ et b/ d'un en-tête `diff --git a/x b/y` (préfixes retirés). */
function headerPaths(header: string): { aPath: string; bPath: string } {
  const rest = header.slice("diff --git ".length);
  const tokens = rest.split(/\s+/).filter(Boolean);
  const rawA = decodeGitPath(tokens[0] ?? "");
  const rawB = decodeGitPath(tokens[1] ?? rawA);
  const aPath = rawA.startsWith("a/") ? rawA.slice(2) : rawA;
  const bPath = rawB.startsWith("b/") ? rawB.slice(2) : rawB;
  return { aPath, bPath };
}

/**
 * Décode un chemin au format C-quoting de Git (`"a\tb"`, échappements `\\`,
 * `\"`, `\n`… et octaux `\ooo`). Retourne tel quel si non entre guillemets.
 */
function decodeGitPath(token: string): string {
  if (!token.startsWith('"')) return token;
  const inner = token.slice(1, -1);
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = inner[++i] ?? "";
    switch (next) {
      case "a": out += "\x07"; break;
      case "b": out += "\b"; break;
      case "t": out += "\t"; break;
      case "n": out += "\n"; break;
      case "v": out += "\v"; break;
      case "f": out += "\f"; break;
      case "r": out += "\r"; break;
      case "\\": out += "\\"; break;
      case '"': out += '"'; break;
      default: {
        if (next >= "0" && next <= "7") {
          const octal = next + (inner[i + 1] ?? "") + (inner[i + 2] ?? "");
          out += String.fromCharCode(Number.parseInt(octal, 8));
          i += 2;
        } else {
          out += next;
        }
      }
    }
  }
  return out;
}
