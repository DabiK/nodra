import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeManifestStore } from "./runtime-manifest-store.js";
import type { RuntimeManifest } from "./runtime-types.js";

const roots: string[] = [];

const manifest = (root: string): RuntimeManifest => ({
  schemaVersion: 1,
  runtimeId: "runtime-test",
  repositoryRoot: "/repo",
  runtimeRoot: root,
  dataRoot: "/data",
  databaseFile: "/data/nodra.db",
  profile: "user",
  temporalNamespace: "nodra",
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
  ownerPid: 1,
  components: Object.fromEntries(
    ["temporal", "opencode", "api", "worker"].map((name) => [name, {
      name,
      ownership: "managed",
      identity: null,
      address: null,
      port: null,
      url: null,
      logFile: null,
      health: "stopped",
      detail: null
    }])
  ) as RuntimeManifest["components"]
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RuntimeManifestStore", () => {
  it("writes atomically, reads, locks and archives stale state", async () => {
    const root = await mkdtemp(join(tmpdir(), "nodra-manifest-"));
    roots.push(root);
    const store = new RuntimeManifestStore(root);
    await store.write(manifest(root));
    await expect(store.read()).resolves.toMatchObject({ runtimeId: "runtime-test" });
    await store.withLock(async () => {
      await expect(store.withLock(async () => undefined)).rejects.toMatchObject({
        code: "RUNTIME_LOCKED"
      });
    });
    const archive = await store.archiveStale();
    expect(archive).toContain("runtime-state.stale-");
    expect(JSON.parse(await readFile(archive!, "utf8"))).toMatchObject({
      runtimeId: "runtime-test"
    });
    await expect(store.read()).resolves.toBeNull();
  });

  it("archives a stale operation lock before proceeding", async () => {
    const root = await mkdtemp(join(tmpdir(), "nodra-manifest-lock-"));
    roots.push(root);
    await writeFile(join(root, "runtime.lock"), JSON.stringify({
      pid: 999_999,
      identity: {
        pid: 999_999,
        pgid: 999_999,
        startedAt: "missing",
        command: "missing",
        signature: "missing"
      }
    }));
    const store = new RuntimeManifestStore(root);
    await expect(store.withLock(async () => "recovered")).resolves.toBe("recovered");
  });
});
