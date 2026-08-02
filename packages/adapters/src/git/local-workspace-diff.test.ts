import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalWorkspaceAdapter } from "./local-workspace-adapter.js";

const exec = promisify(execFile);

describe("LocalWorkspaceAdapter diff", () => {
  let root: string;
  let repositoryPath: string;
  let adapter: LocalWorkspaceAdapter;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "nodra-diff-")));
    repositoryPath = join(root, "repository");
    adapter = new LocalWorkspaceAdapter(join(root, "managed"));
    await adapter.initialize();
    await exec("git", ["init", repositoryPath]);
    await exec("git", ["-C", repositoryPath, "config", "user.name", "Nodra Test"]);
    await exec("git", ["-C", repositoryPath, "config", "user.email", "nodra@example.test"]);
    await writeFile(join(repositoryPath, "tracked.txt"), "line one\nline two\n");
    await writeFile(join(repositoryPath, "removed.txt"), "to be removed\n");
    await exec("git", ["-C", repositoryPath, "add", "tracked.txt", "removed.txt"]);
    await exec("git", ["-C", repositoryPath, "commit", "-m", "initial"]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("diffe l'arbre de travail : modifié, supprimé et non suivi, avec contenu et compteurs", async () => {
    await writeFile(join(repositoryPath, "tracked.txt"), "line one\nline two MODIFIED\nline three\n");
    await rm(join(repositoryPath, "removed.txt"));
    await writeFile(join(repositoryPath, "new-file.txt"), "hello\nworld\n");

    const diff = await adapter.diff({ path: repositoryPath, base: null, head: null });

    expect(diff.head).toBeNull();
    expect(diff.base).toMatch(/^[a-f0-9]{40}$/);
    const byPath = new Map(diff.files.map((file) => [file.path, file]));

    const modified = byPath.get("tracked.txt");
    expect(modified).toMatchObject({ status: "modified", additions: 2, deletions: 1 });
    expect(modified?.content).toContain("diff --git a/tracked.txt b/tracked.txt");
    expect(modified?.content).toContain("-line two");
    expect(modified?.content).toContain("+line two MODIFIED");
    expect(modified?.content).toContain("+line three");

    const deleted = byPath.get("removed.txt");
    expect(deleted).toMatchObject({ status: "deleted", additions: 0, deletions: 1 });
    expect(deleted?.content).toContain("diff --git a/removed.txt b/removed.txt");
    expect(deleted?.content).toContain("-to be removed");

    const added = byPath.get("new-file.txt");
    expect(added).toMatchObject({ status: "added", oldPath: null, additions: 2, deletions: 0 });
    expect(added?.content).toContain("new file mode 100644");
    expect(added?.content).toContain("+hello");
    expect(added?.content).toContain("+world");
    expect(added?.content).toContain("@@ -0,0 +1,2 @@");
  });

  it("diffe deux commits quand head est fourni, sans inclure les fichiers non suivis", async () => {
    const base = (await exec("git", ["-C", repositoryPath, "rev-parse", "HEAD"])).stdout.trim();
    await writeFile(join(repositoryPath, "tracked.txt"), "line one\nline two COMMITTED\n");
    await exec("git", ["-C", repositoryPath, "add", "tracked.txt"]);
    await exec("git", ["-C", repositoryPath, "commit", "-m", "second"]);
    const head = (await exec("git", ["-C", repositoryPath, "rev-parse", "HEAD"])).stdout.trim();

    await writeFile(join(repositoryPath, "untracked.txt"), "not committed\n");
    const diff = await adapter.diff({ path: repositoryPath, base, head });

    expect(diff.head).toBe(head);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]!).toMatchObject({
      path: "tracked.txt",
      status: "modified",
      additions: 1,
      deletions: 1
    });
    expect(diff.files[0]!.content).toContain("+line two COMMITTED");
  });

  it("détecte les renommages (base → head)", async () => {
    const base = (await exec("git", ["-C", repositoryPath, "rev-parse", "HEAD"])).stdout.trim();
    await exec("git", ["-C", repositoryPath, "mv", "tracked.txt", "renamed.txt"]);
    await exec("git", ["-C", repositoryPath, "commit", "-m", "rename"]);
    const head = (await exec("git", ["-C", repositoryPath, "rev-parse", "HEAD"])).stdout.trim();

    const diff = await adapter.diff({ path: repositoryPath, base, head });

    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]).toMatchObject({
      path: "renamed.txt",
      oldPath: "tracked.txt",
      status: "renamed"
    });
  });

  it("rapporte des compteurs nuls pour les fichiers binaires", async () => {
    const base = (await exec("git", ["-C", repositoryPath, "rev-parse", "HEAD"])).stdout.trim();
    const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
    await writeFile(join(repositoryPath, "blob.bin"), binary);
    await exec("git", ["-C", repositoryPath, "add", "blob.bin"]);
    await exec("git", ["-C", repositoryPath, "commit", "-m", "binary"]);
    const head = (await exec("git", ["-C", repositoryPath, "rev-parse", "HEAD"])).stdout.trim();

    const diff = await adapter.diff({ path: repositoryPath, base, head });

    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]!).toMatchObject({ path: "blob.bin", status: "added", additions: null, deletions: null });
    expect(diff.files[0]!.content).toContain("Binary files");
  });

  it("diffe avec des chemins contenant des espaces (C-quoting git)", async () => {
    await writeFile(join(repositoryPath, "my file.txt"), "spaced\n");
    const diff = await adapter.diff({ path: repositoryPath, base: null, head: null });
    expect(diff.files.some((file) => file.path === "my file.txt")).toBe(true);
  });

  it("retourne une liste vide quand rien n'a changé", async () => {
    const diff = await adapter.diff({ path: repositoryPath, base: null, head: null });
    expect(diff.files).toHaveLength(0);
  });

  it("compare la base explicite au head explicite", async () => {
    const base = (await exec("git", ["-C", repositoryPath, "rev-parse", "HEAD"])).stdout.trim();
    await writeFile(join(repositoryPath, "tracked.txt"), "changed\n");
    await exec("git", ["-C", repositoryPath, "add", "tracked.txt"]);
    await exec("git", ["-C", repositoryPath, "commit", "-m", "change"]);
    const head = (await exec("git", ["-C", repositoryPath, "rev-parse", "HEAD"])).stdout.trim();

    const diff = await adapter.diff({ path: repositoryPath, base, head });
    expect(diff.base).toBe(base);
    expect(diff.head).toBe(head);
    expect(diff.files).toHaveLength(1);
  });

  it("diffe un sous-dossier du dépôt (chemin canonisé)", async () => {
    await mkdir(join(repositoryPath, "sub"), { recursive: true });
    await writeFile(join(repositoryPath, "sub", "nested.txt"), "nested\n");
    const diff = await adapter.diff({ path: join(repositoryPath, "sub"), base: null, head: null });
    expect(diff.files.map((file) => file.path)).toContain("sub/nested.txt");
  });
});
