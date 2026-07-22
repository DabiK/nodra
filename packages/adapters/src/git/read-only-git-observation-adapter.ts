import type { GitObservation, GitObservationPort } from "@nodra/application";
import { DomainError } from "@nodra/application";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export class ReadOnlyGitObservationAdapter implements GitObservationPort {
  async observe(cwdValue: string, workspaceRootValue: string): Promise<GitObservation> {
    const cwd = await realpath(cwdValue).catch(() => { throw new DomainError("Git cwd does not exist", "CWD_INVALID"); });
    const workspace = await realpath(workspaceRootValue).catch(() => { throw new DomainError("Workspace does not exist", "WORKSPACE_INVALID"); });
    const rel = relative(workspace, cwd);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new DomainError("Git cwd escapes run workspace", "CWD_ESCAPE");
    try {
      const root = (await execute("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", maxBuffer: 1024 * 1024 })).stdout.trim();
      const canonicalRoot = await realpath(root);
      const repositoryRelative = relative(workspace, canonicalRoot);
      if (isAbsolute(repositoryRelative) || repositoryRelative === ".." || repositoryRelative.startsWith(`..${sep}`)) {
        throw new DomainError("Git repository escapes run workspace", "CWD_ESCAPE");
      }
      const head = (await execute("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8", maxBuffer: 1024 * 1024 })).stdout.trim();
      const status = (await execute("git", ["-C", cwd, "status", "--porcelain=v1", "-z", "--untracked-files=all"], { encoding: "buffer", maxBuffer: 10_000_000 })).stdout;
      const diff = (await execute("git", ["-C", cwd, "diff", "--no-ext-diff", "--binary", "HEAD", "--"], { encoding: "buffer", maxBuffer: 10_000_000 })).stdout;
      const untrackedList = (await execute("git", ["-C", cwd, "ls-files", "--others", "--exclude-standard", "-z"], { encoding: "buffer", maxBuffer: 10_000_000 })).stdout;
      const untracked: Buffer[] = [];
      for (const name of untrackedList.toString("utf8").split("\0").filter(Boolean).sort()) {
        const path = resolve(canonicalRoot, name); const pathRelative = relative(canonicalRoot, path);
        if (isAbsolute(pathRelative) || pathRelative === ".." || pathRelative.startsWith(`..${sep}`)) throw new DomainError("Git path escapes repository", "PATH_ESCAPE");
        const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new DomainError("Git observation refuses symlinked files", "PATH_ESCAPE");
        untracked.push(Buffer.from(name), Buffer.from([0]), await readFile(path), Buffer.from([0]));
      }
      const untrackedContent = Buffer.concat(untracked);
      const material = Buffer.concat([Buffer.from(head), Buffer.from([0]), status, Buffer.from([0]), diff, Buffer.from([0]), untrackedContent]);
      return {
        schemaVersion: 1,
        collectorId: "nodra.git",
        collectorVersion: "1",
        cwd,
        head,
        treeDigest: createHash("sha256").update(material).digest("hex"),
        diffDigest: createHash("sha256").update(Buffer.concat([status, Buffer.from([0]), diff, Buffer.from([0]), untrackedContent])).digest("hex"),
        dirty: status.length > 0,
        capturedAt: new Date().toISOString()
      };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("No readable Git repository is available for this run", "GIT_UNAVAILABLE");
    }
  }
}
