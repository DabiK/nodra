import { describe, expect, it } from "vitest";
import { RuntimeConfig } from "./runtime-config.js";

describe("RuntimeConfig", () => {
  it("uses an explicit local profile and loopback overrides", () => {
    const config = RuntimeConfig.load({
      PATH: process.env.PATH,
      NODRA_RUNTIME_PROFILE: "local",
      NODRA_DATA_ROOT: "/tmp/nodra-runtime-config",
      NODRA_TEMPORAL_ADDRESS: "localhost:8123",
      NODRA_OPENCODE_URL: "http://localhost:8124",
      NODRA_API_URL: "http://127.0.0.1:8125",
      NODRA_OPENCODE_LOCAL_MODEL: "qwen3:8b"
    }, "/tmp/repository");

    expect(config.profile).toBe("local");
    expect(config.temporalAddress).toBe("127.0.0.1:8123");
    expect(config.opencodeUrl).toBe("http://127.0.0.1:8124");
    expect(config.apiUrl).toBe("http://127.0.0.1:8125");
    expect(config.localModel).toBe("qwen3:8b");
    expect(config.runtimeRoot).toBe("/tmp/nodra-runtime-config/runtime");
  });

  it("rejects non-loopback service overrides and unknown profiles", () => {
    expect(() => RuntimeConfig.load({
      PATH: process.env.PATH,
      NODRA_OPENCODE_URL: "http://0.0.0.0:4096"
    }, "/tmp/repository")).toThrow("loopback");
    expect(() => RuntimeConfig.load({
      PATH: process.env.PATH,
      NODRA_RUNTIME_PROFILE: "automatic"
    }, "/tmp/repository")).toThrow("local or user");
  });
});
