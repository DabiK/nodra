import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { RuntimeError } from "./runtime-errors.js";
import type { RuntimeConfiguration } from "./runtime-types.js";

export class RuntimeConfig {
  static load(
    environment: NodeJS.ProcessEnv = process.env,
    workingDirectory = process.cwd()
  ): RuntimeConfiguration {
    const repositoryRoot = resolve(workingDirectory);
    const dataRoot = resolve(environment.NODRA_DATA_ROOT ?? `${repositoryRoot}/data/local`);
    const runtimeRoot = resolve(environment.NODRA_RUNTIME_ROOT ?? `${dataRoot}/runtime`);
    const profile = this.readProfile(environment.NODRA_RUNTIME_PROFILE);
    return {
      repositoryRoot,
      runtimeRoot,
      dataRoot,
      databaseFile: resolve(environment.NODRA_DATABASE_FILE ?? `${dataRoot}/nodra.db`),
      profile,
      temporalAddress: this.optionalTemporalAddress(environment.NODRA_TEMPORAL_ADDRESS),
      temporalNamespace: environment.NODRA_TEMPORAL_NAMESPACE?.trim() || "nodra",
      opencodeUrl: this.optionalLoopbackUrl(environment.NODRA_OPENCODE_URL, "NODRA_OPENCODE_URL"),
      apiUrl: this.optionalLoopbackUrl(environment.NODRA_API_URL, "NODRA_API_URL"),
      temporalBinary: this.resolveBinary(
        environment.NODRA_TEMPORAL_BINARY,
        "temporal"
      ),
      opencodeBinary: this.resolveBinary(
        environment.NODRA_OPENCODE_BINARY,
        "opencode"
      ),
      tsxBinary: resolve(repositoryRoot, "node_modules/.bin/tsx"),
      opencodeConfigFile: environment.OPENCODE_CONFIG
        ? resolve(environment.OPENCODE_CONFIG)
        : null,
      ollamaUrl: this.loopbackUrl(
        environment.NODRA_OLLAMA_URL ?? "http://127.0.0.1:11434",
        "NODRA_OLLAMA_URL"
      ),
      localModel: environment.NODRA_OPENCODE_LOCAL_MODEL?.trim() || "gemma3:4b",
      stopTimeoutMs: this.positiveInteger(environment.NODRA_RUNTIME_STOP_TIMEOUT_MS, 5_000)
    };
  }

  private static readProfile(value: string | undefined): "local" | "user" {
    const profile = value?.trim() || "user";
    if (profile !== "local" && profile !== "user") {
      throw new RuntimeError(
        "NODRA_RUNTIME_PROFILE must be local or user",
        "RUNTIME_PROFILE_INVALID"
      );
    }
    return profile;
  }

  private static optionalTemporalAddress(value: string | undefined): string | null {
    if (!value?.trim()) return null;
    const match = /^(?:127\.0\.0\.1|localhost):(\d+)$/.exec(value.trim());
    const port = Number(match?.[1]);
    if (!match || !Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new RuntimeError(
        "NODRA_TEMPORAL_ADDRESS must be loopback host:port",
        "RUNTIME_ADDRESS_INVALID"
      );
    }
    return `127.0.0.1:${port}`;
  }

  private static optionalLoopbackUrl(value: string | undefined, name: string): string | null {
    return value?.trim() ? this.loopbackUrl(value, name) : null;
  }

  private static loopbackUrl(value: string, name: string): string {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new RuntimeError(`${name} must be an HTTP loopback URL`, "RUNTIME_URL_INVALID");
    }
    if (
      parsed.protocol !== "http:"
      || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)
    ) {
      throw new RuntimeError(`${name} must be an HTTP loopback URL`, "RUNTIME_URL_INVALID");
    }
    return parsed.origin.replace("localhost", "127.0.0.1");
  }

  private static resolveBinary(
    explicit: string | undefined,
    name: string
  ): string {
    if (explicit?.trim()) return resolve(explicit);
    const result = spawnSync("which", [name], { encoding: "utf8" });
    if (result.status !== 0 || !result.stdout.trim()) return name;
    return resolve(result.stdout.trim());
  }

  private static positiveInteger(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new RuntimeError(
        "NODRA_RUNTIME_STOP_TIMEOUT_MS must be a positive integer",
        "RUNTIME_TIMEOUT_INVALID"
      );
    }
    return parsed;
  }
}
