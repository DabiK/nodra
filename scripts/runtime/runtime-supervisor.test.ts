import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessInspector } from "./process-inspector.js";
import { RuntimeManifestStore } from "./runtime-manifest-store.js";
import { RuntimeSupervisor } from "./runtime-supervisor.js";
import type { RuntimeConfiguration, RuntimeManifest } from "./runtime-types.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((operation) => operation()));
});

describe("RuntimeSupervisor ownership", () => {
  it("marks stale managed identities and never stops external processes", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "nodra-supervisor-"));
    const external = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: "ignore"
    });
    external.unref();
    const inspector = new ProcessInspector();
    let identity = null;
    for (let attempt = 0; attempt < 50 && !identity; attempt += 1) {
      identity = inspector.inspect(external.pid!);
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    cleanup.push(async () => {
      const current = inspector.inspect(external.pid!);
      if (current) process.kill(-current.pgid, "SIGKILL");
      await rm(runtimeRoot, { recursive: true, force: true });
    });
    const components = Object.fromEntries(
      ["temporal", "opencode", "api", "worker"].map((name) => [name, {
        name,
        ownership: name === "api" ? "external" : "managed",
        identity: name === "api" ? identity : { ...identity!, signature: `stale-${name}` },
        address: null,
        port: null,
        url: null,
        logFile: null,
        health: "ready",
        detail: null
      }])
    ) as RuntimeManifest["components"];
    const manifest: RuntimeManifest = {
      schemaVersion: 1,
      runtimeId: "ownership-test",
      repositoryRoot: process.cwd(),
      runtimeRoot,
      dataRoot: runtimeRoot,
      databaseFile: join(runtimeRoot, "nodra.db"),
      profile: "user",
      temporalNamespace: "nodra",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerPid: process.pid,
      components
    };
    await new RuntimeManifestStore(runtimeRoot).write(manifest);
    const config: RuntimeConfiguration = {
      repositoryRoot: process.cwd(),
      runtimeRoot,
      dataRoot: runtimeRoot,
      databaseFile: join(runtimeRoot, "nodra.db"),
      profile: "user",
      temporalAddress: null,
      temporalNamespace: "nodra",
      opencodeUrl: null,
      apiUrl: null,
      temporalBinary: "temporal",
      opencodeBinary: "opencode",
      tsxBinary: join(process.cwd(), "node_modules/.bin/tsx"),
      opencodeConfigFile: null,
      ollamaUrl: "http://127.0.0.1:11434",
      localModel: "gemma3:4b",
      stopTimeoutMs: 100
    };
    const supervisor = new RuntimeSupervisor(config);
    const status = await supervisor.status();
    expect(
      status.components
        .filter((component) => component.ownership === "managed")
        .every((component) => component.health === "stale")
    ).toBe(true);

    await supervisor.stop();
    expect(inspector.inspect(external.pid!)).not.toBeNull();
  });
});
