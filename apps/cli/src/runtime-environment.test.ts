import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRuntimeEnvironment } from "./runtime-environment.js";

describe("readRuntimeEnvironment", () => {
  it("prefers runtime:start manifest over stale shell variables", async () => {
    const root = mkdtempSync(join(tmpdir(), "nodra-cli-runtime-"));
    const runtimeRoot = join(root, "runtime");
    await mkdir(runtimeRoot, { recursive: true });
    await writeFile(join(runtimeRoot, "runtime-state.json"), JSON.stringify({
      databaseFile: join(root, "runtime.db"),
      dataRoot: join(root, "runtime-data"),
      temporalNamespace: "runtime-namespace",
      components: {
        temporal: { address: "127.0.0.1:7123" },
        opencode: { url: "http://127.0.0.1:7124" },
        api: { url: "http://127.0.0.1:7125" }
      }
    }));
    const environment: NodeJS.ProcessEnv = {
      NODRA_RUNTIME_ROOT: runtimeRoot,
      NODRA_DATABASE_FILE: join(root, "stale.db"),
      NODRA_DATA_ROOT: join(root, "stale-data"),
      NODRA_TEMPORAL_ADDRESS: "127.0.0.1:9999"
    };

    expect(readRuntimeEnvironment(root, environment)).toEqual({
      databaseFile: join(root, "runtime.db"),
      dataRoot: join(root, "runtime-data"),
      temporalAddress: "127.0.0.1:7123",
      temporalNamespace: "runtime-namespace"
    });
    expect(environment.NODRA_OPENCODE_URL).toBe("http://127.0.0.1:7124");
    expect(environment.NODRA_API_URL).toBe("http://127.0.0.1:7125");
  });
});
