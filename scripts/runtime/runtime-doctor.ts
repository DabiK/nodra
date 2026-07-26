import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { RuntimeHealth } from "./runtime-health.js";
import { stripAnsi } from "./strip-ansi.js";
import type {
  DoctorCheck,
  DoctorReport,
  RuntimeConfiguration,
  RuntimeStatus
} from "./runtime-types.js";

export class RuntimeDoctor {
  private readonly health = new RuntimeHealth();

  constructor(private readonly config: RuntimeConfiguration) {}

  async run(status: RuntimeStatus): Promise<DoctorReport> {
    const checks: DoctorCheck[] = [];
    checks.push(this.nodeCheck());
    checks.push(this.binaryCheck(
      "temporal-binary",
      this.config.temporalBinary,
      ["--disable-config-file", "--disable-config-env", "--version"]
    ));
    checks.push(this.binaryCheck("opencode-binary", this.config.opencodeBinary, ["--version"]));

    const manifest = status.manifest;
    const temporal = manifest?.components.temporal;
    if (temporal?.address) {
      const result = await this.health.temporal(
        temporal.address,
        manifest?.temporalNamespace ?? this.config.temporalNamespace
      );
      checks.push({
        name: "temporal-namespace",
        status: result.ready ? "ok" : "error",
        detail: result.detail
      });
    } else {
      checks.push({ name: "temporal-namespace", status: "error", detail: "runtime is not started" });
    }

    const opencode = manifest?.components.opencode;
    if (opencode?.url) {
      const result = await this.health.opencode(opencode.url);
      checks.push({
        name: "opencode-health-catalogue",
        status: result.ready ? "ok" : "error",
        detail: result.ready ? `${result.detail}: ${result.models.join(", ")}` : result.detail
      });
      checks.push(this.providerSnapshotProbe(opencode.url, "opencode"));
    } else {
      checks.push({
        name: "opencode-health-catalogue",
        status: "error",
        detail: "runtime is not started"
      });
      checks.push({
        name: "provider-snapshot-opencode",
        status: "error",
        detail: "OpenCode URL is unavailable; snapshot was not probed"
      });
    }

    const api = manifest?.components.api;
    if (api?.url) {
      const result = await this.health.api(api.url);
      checks.push({ name: "api", status: result.ready ? "ok" : "error", detail: result.detail });
    } else {
      checks.push({ name: "api", status: "error", detail: "runtime is not started" });
    }

    const worker = status.components.find((component) => component.name === "worker");
    checks.push({
      name: "worker-readiness",
      status: worker?.health === "ready" ? "ok" : "error",
      detail: worker?.detail ?? "worker is unavailable"
    });

    if (this.config.profile === "local") {
      checks.push(await this.ollamaToolCallingCheck());
    } else {
      checks.push({
        name: "opencode-user-profile",
        status: "ok",
        detail: this.config.opencodeConfigFile
          ? `OpenCode reads provider configuration from ${this.config.opencodeConfigFile}`
          : "OpenCode reads its user provider configuration; Nodra stores no credentials"
      });
    }

    if (process.env.NODRA_DOCTOR_CODEX === "1") {
      checks.push(this.providerSnapshotProbe(
        opencode?.url ?? this.config.opencodeUrl ?? "http://127.0.0.1:4096",
        "codex"
      ));
    }

    return {
      ready: checks.every((check) => check.status !== "error"),
      profile: this.config.profile,
      checks
    };
  }

  private nodeCheck(): DoctorCheck {
    const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
    const supported = major > 22 || (major === 22 && minor >= 12);
    return {
      name: "node",
      status: supported ? "ok" : "error",
      detail: `Node ${process.versions.node}; required >=22.12.0`
    };
  }

  private binaryCheck(name: string, binary: string, arguments_: string[]): DoctorCheck {
    const result = spawnSync(binary, arguments_, {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" }
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
      .trim();
    return {
      name,
      status: result.status === 0 ? "ok" : "error",
      detail: result.status === 0
        ? `${binary}: ${stripAnsi(output).split("\n").at(-1)}`
        : `${binary} is unavailable or failed; install/configure it explicitly`
    };
  }

  private providerSnapshotProbe(opencodeUrl: string, providerId: "opencode" | "codex"): DoctorCheck {
    const result = spawnSync(
      this.config.tsxBinary,
      [
        resolve(this.config.repositoryRoot, "apps/cli/src/main.ts"),
        "provider:probe",
        providerId,
        "--allow-process"
      ],
      {
        cwd: this.config.repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          NODRA_DATA_ROOT: this.config.dataRoot,
          NODRA_DATABASE_FILE: this.config.databaseFile,
          NODRA_OPENCODE_URL: opencodeUrl,
          NODRA_TEMPORAL_ADDRESS: this.config.temporalAddress ?? "127.0.0.1:7233",
          NODRA_TEMPORAL_NAMESPACE: this.config.temporalNamespace,
          NO_COLOR: "1",
          FORCE_COLOR: "0"
        }
      }
    );
    const output = (result.stdout || result.stderr).trim();
    if (result.status !== 0) {
      return {
        name: `provider-snapshot-${providerId}`,
        status: "error",
        detail: output.slice(-1_000) || "provider probe failed without output"
      };
    }
    try {
      const snapshot = JSON.parse(output) as {
        health?: { status?: string; reason?: string | null };
        binaryVersion?: string | null;
        models?: unknown[];
        capabilities?: { contract?: { status?: string } };
      };
      const ready = snapshot.health?.status === "ready";
      return {
        name: `provider-snapshot-${providerId}`,
        status: ready ? "ok" : "error",
        detail: `health=${snapshot.health?.status}; contract=${
          snapshot.capabilities?.contract?.status
        }; version=${snapshot.binaryVersion}; models=${snapshot.models?.length ?? 0}${
          snapshot.health?.reason ? `; reason=${snapshot.health.reason}` : ""
        }`
      };
    } catch {
      return {
        name: `provider-snapshot-${providerId}`,
        status: "error",
        detail: "provider probe returned invalid JSON"
      };
    }
  }

  private async ollamaToolCallingCheck(): Promise<DoctorCheck> {
    try {
      const response = await fetch(`${this.config.ollamaUrl}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.config.localModel }),
        signal: AbortSignal.timeout(2_000)
      });
      const payload = await response.json() as { capabilities?: string[] };
      const capabilities = payload.capabilities ?? [];
      const toolCalling = capabilities.includes("tools");
      return {
        name: "ollama-tool-calling",
        status: response.ok && toolCalling ? "ok" : "error",
        detail: toolCalling
          ? `${this.config.localModel} exposes tools`
          : `${this.config.localModel} capabilities=${capabilities.join(",") || "unknown"}; OpenCode is not ready for agent missions`
      };
    } catch (error) {
      return {
        name: "ollama-tool-calling",
        status: "error",
        detail: `Ollama local profile unavailable: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}
