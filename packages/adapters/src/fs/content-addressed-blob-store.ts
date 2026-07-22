import type { BlobRecord, BlobStorePort } from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export class ContentAddressedBlobStore implements BlobStorePort {
  constructor(private readonly dataRoot: string, private readonly maxBlobBytes = 10_000_000) {}

  async put(content: Uint8Array, mimeType: string, occurredAt: string): Promise<BlobRecord> {
    if (content.byteLength > this.maxBlobBytes) throw new DomainError("Blob exceeds configured size limit", "BLOB_TOO_LARGE");
    const root = await this.safeArtifactRoot();
    const sha256 = createHash("sha256").update(content).digest("hex");
    const relativePath = `artifacts/${sha256.slice(0, 2)}/${sha256}`;
    const target = this.resolveRelative(root, relativePath.slice("artifacts/".length));
    await mkdir(dirname(target), { recursive: true });
    await this.assertNoSymlink(dirname(target), root);
    const temporary = resolve(dirname(target), `.${sha256}.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try { await rename(temporary, target); }
    finally { await unlink(temporary).catch(() => undefined); }
    const stored = await readFile(target);
    if (stored.byteLength !== content.byteLength || createHash("sha256").update(stored).digest("hex") !== sha256) {
      throw new DomainError("Stored blob digest mismatch", "BLOB_DIGEST_MISMATCH");
    }
    return { id: toId(`blob/${sha256}`), sha256, relativePath, mimeType, byteSize: content.byteLength, createdAt: occurredAt };
  }

  async verify(blob: BlobRecord): Promise<boolean> {
    try {
      const root = await this.safeArtifactRoot();
      if (isAbsolute(blob.relativePath) || !blob.relativePath.startsWith("artifacts/")) return false;
      const target = this.resolveRelative(root, blob.relativePath.slice("artifacts/".length));
      await this.assertNoSymlink(dirname(target), root);
      const stat = await lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== blob.byteSize) return false;
      return createHash("sha256").update(await readFile(target)).digest("hex") === blob.sha256;
    } catch { return false; }
  }

  private async safeArtifactRoot(): Promise<string> {
    await mkdir(this.dataRoot, { recursive: true });
    const canonicalData = await realpath(this.dataRoot);
    const artifactRoot = resolve(canonicalData, "artifacts");
    await mkdir(artifactRoot, { recursive: true });
    const canonicalArtifacts = await realpath(artifactRoot);
    if (!this.within(canonicalData, canonicalArtifacts)) throw new DomainError("Artifact root escapes data root", "PATH_ESCAPE");
    return canonicalArtifacts;
  }

  private resolveRelative(root: string, value: string): string {
    const target = resolve(root, value);
    if (!this.within(root, target)) throw new DomainError("Artifact path escapes data root", "PATH_ESCAPE");
    return target;
  }

  private async assertNoSymlink(directory: string, root: string): Promise<void> {
    const canonical = await realpath(directory);
    if (!this.within(root, canonical)) throw new DomainError("Artifact path follows a symlink outside data root", "PATH_ESCAPE");
  }

  private within(root: string, target: string) {
    const path = relative(root, target);
    return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
  }
}
