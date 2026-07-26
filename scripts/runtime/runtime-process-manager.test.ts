import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessInspector } from "./process-inspector.js";
import { RuntimeProcessManager } from "./runtime-process-manager.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((operation) => operation()));
});

describe("RuntimeProcessManager", () => {
  it("checks PID, process group, start time and signature before stopping", async () => {
    const root = await mkdtemp(join(tmpdir(), "nodra-process-"));
    const inspector = new ProcessInspector();
    const manager = new RuntimeProcessManager(process.cwd(), inspector);
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    cleanup.push(async () => {
      const identity = inspector.inspect(child.pid!);
      if (identity) {
        try {
          process.kill(-identity.pgid, "SIGKILL");
        } catch {
          // The validated test process may already have exited.
        }
      }
      await rm(root, { recursive: true, force: true });
    });
    let identity = null;
    for (let attempt = 0; attempt < 50 && !identity; attempt += 1) {
      identity = inspector.inspect(child.pid!);
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    expect(identity).not.toBeNull();
    expect(inspector.matches(identity!)).toBe(true);
    await expect(manager.stop({ ...identity!, signature: "tampered" }, 100))
      .resolves.toBe("identity_mismatch");
    expect(inspector.inspect(child.pid!)).not.toBeNull();
    await expect(manager.stop(identity!, 1_000)).resolves.toBe("stopped");
    expect(inspector.inspect(child.pid!)).toBeNull();
  });
});
