import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ContentAddressedBlobStore } from "./content-addressed-blob-store.js";

describe("ContentAddressedBlobStore", () => {
  it("atomically deduplicates content and detects corruption", async () => {
    const root = await mkdtemp(join(tmpdir(), "nodra-blobs-")); const store = new ContentAddressedBlobStore(root, 100);
    const first = await store.put(Buffer.from("proof"), "text/plain", new Date().toISOString()); const second = await store.put(Buffer.from("proof"), "text/plain", new Date().toISOString());
    expect(second.sha256).toBe(first.sha256); expect(await readFile(join(root, first.relativePath), "utf8")).toBe("proof"); expect(await store.verify(first)).toBe(true);
    await writeFile(join(root, first.relativePath), "corrupt"); expect(await store.verify(first)).toBe(false);
  });
  it("refuses oversized blobs and an artifact symlink escape", async () => {
    const root = await mkdtemp(join(tmpdir(), "nodra-blobs-")); const outside = await mkdtemp(join(tmpdir(), "nodra-outside-"));
    await symlink(outside, join(root, "artifacts"));
    await expect(new ContentAddressedBlobStore(root).put(Buffer.from("x"), "text/plain", new Date().toISOString())).rejects.toMatchObject({ code: "PATH_ESCAPE" });
    const clean = await mkdtemp(join(tmpdir(), "nodra-cap-")); await expect(new ContentAddressedBlobStore(clean, 1).put(Buffer.from("xx"), "text/plain", new Date().toISOString())).rejects.toMatchObject({ code: "BLOB_TOO_LARGE" });
  });
});
