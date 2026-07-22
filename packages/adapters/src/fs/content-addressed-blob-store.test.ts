import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ContentAddressedBlobStore } from "./content-addressed-blob-store.js";

describe("ContentAddressedBlobStore", () => {
  it("atomically deduplicates content and detects corruption", async () => {
    const root = await mkdtemp(join(tmpdir(), "nodra-blobs-")); const store = new ContentAddressedBlobStore(root, 100);
    const [first, second] = await Promise.all([store.put(Buffer.from("proof"), "text/plain", new Date().toISOString()), store.put(Buffer.from("proof"), "text/plain", new Date().toISOString())]);
    expect(second.sha256).toBe(first.sha256); expect(second.relativePath).toBe(first.relativePath); expect(await readFile(join(root, first.relativePath), "utf8")).toBe("proof"); expect(await store.verify(first)).toBe(true);
    expect(await store.verify({ ...first, id: first.id.replace("blob/", "wrong/") as typeof first.id })).toBe(false); expect(await store.verify({ ...first, relativePath: `artifacts/ff/${first.sha256}` })).toBe(false);
    await writeFile(join(root, first.relativePath), "corrupt"); expect(await store.verify(first)).toBe(false);
  });
  it("never overwrites a corrupt pre-existing canonical target", async () => {
    const root = await mkdtemp(join(tmpdir(), "nodra-corrupt-target-")); const content = Buffer.from("expected"); const digest = createHash("sha256").update(content).digest("hex"); const path = join(root, "artifacts", digest.slice(0, 2), digest); await mkdir(join(root, "artifacts", digest.slice(0, 2)), { recursive: true }); await writeFile(path, "corrupt");
    await expect(new ContentAddressedBlobStore(root).put(content, "text/plain", new Date().toISOString())).rejects.toMatchObject({ code: "BLOB_DIGEST_MISMATCH" }); expect(await readFile(path, "utf8")).toBe("corrupt");
  });
  it("refuses oversized blobs and an artifact symlink escape", async () => {
    const root = await mkdtemp(join(tmpdir(), "nodra-blobs-")); const outside = await mkdtemp(join(tmpdir(), "nodra-outside-"));
    await symlink(outside, join(root, "artifacts"));
    await expect(new ContentAddressedBlobStore(root).put(Buffer.from("x"), "text/plain", new Date().toISOString())).rejects.toMatchObject({ code: "PATH_ESCAPE" });
    const clean = await mkdtemp(join(tmpdir(), "nodra-cap-")); await expect(new ContentAddressedBlobStore(clean, 1).put(Buffer.from("xx"), "text/plain", new Date().toISOString())).rejects.toMatchObject({ code: "BLOB_TOO_LARGE" });
  });
});
