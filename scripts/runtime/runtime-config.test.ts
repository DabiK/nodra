import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RuntimeConfig } from "./runtime-config.js";

const dataRoot = resolve("test-fixtures/nodra-runtime-config");
const repository = resolve("test-fixtures/repository");

describe("RuntimeConfig", () => {
  it("uses an explicit local profile and loopback overrides", () => {
    const config = RuntimeConfig.load({
      PATH: process.env.PATH,
      NODRA_RUNTIME_PROFILE: "local",
      NODRA_DATA_ROOT: dataRoot,
      NODRA_TEMPORAL_ADDRESS: "localhost:8123",
      NODRA_OPENCODE_URL: "http://localhost:8124",
      NODRA_API_URL: "http://127.0.0.1:8125",
      NODRA_OPENCODE_LOCAL_MODEL: "qwen3:8b"
    }, repository);

    expect(config.profile).toBe("local");
    expect(config.temporalAddress).toBe("127.0.0.1:8123");
    expect(config.opencodeUrl).toBe("http://127.0.0.1:8124");
    expect(config.apiUrl).toBe("http://127.0.0.1:8125");
    expect(config.localModel).toBe("qwen3:8b");
    // Path comparisons go through resolve()/join() so they hold on every OS.
    expect(config.runtimeRoot).toBe(join(dataRoot, "runtime"));
    expect(config.databaseFile).toBe(join(dataRoot, "nodra.db"));
  });

  it("rejects non-loopback service overrides and unknown profiles", () => {
    expect(() => RuntimeConfig.load({
      PATH: process.env.PATH,
      NODRA_OPENCODE_URL: "http://0.0.0.0:4096"
    }, repository)).toThrow("loopback");
    expect(() => RuntimeConfig.load({
      PATH: process.env.PATH,
      NODRA_RUNTIME_PROFILE: "automatic"
    }, repository)).toThrow("local or user");
  });

  it("resolves binaries cross-platform (explicit path, tsx shim, PATH fallback)", () => {
    const config = RuntimeConfig.load({
      PATH: "",
      NODRA_TEMPORAL_BINARY: "vendor/temporal-bin",
      NODRA_OPENCODE_BINARY: "vendor/opencode-bin"
    }, repository);

    // Explicit binaries are resolved to absolute paths verbatim.
    expect(config.temporalBinary).toBe(resolve("vendor/temporal-bin"));
    expect(config.opencodeBinary).toBe(resolve("vendor/opencode-bin"));

    // The tsx shim lives in node_modules/.bin; on Windows it carries a .cmd
    // extension, on POSIX it is extension-less.
    const expectedTsx = resolve(repository, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
    expect(config.tsxBinary).toBe(expectedTsx);
  });

  it("falls back to the bare binary name when it cannot be found on an empty PATH", () => {
    const config = RuntimeConfig.load({ PATH: "" }, repository);
    // No `which`/`where` shell-out: an unresolved name is returned as-is so a
    // later spawn surfaces a clear ENOENT rather than crashing on lookup.
    expect(config.temporalBinary).toBe("temporal");
    expect(config.opencodeBinary).toBe("opencode");
  });
});
