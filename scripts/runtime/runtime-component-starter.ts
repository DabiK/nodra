import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { migrateDatabase } from "../../packages/adapters/src/sqlite/migrate-database.js";
import { NodraSqliteDatabase } from "../../packages/adapters/src/sqlite/nodra-sqlite-database.js";
import { PortAllocator } from "./port-allocator.js";
import type { ProcessInspector } from "./process-inspector.js";
import type { RuntimeHealth } from "./runtime-health.js";
import type { RuntimeManifestStore } from "./runtime-manifest-store.js";
import type { RuntimeProcessManager } from "./runtime-process-manager.js";
import type {
  RuntimeComponentManifest,
  RuntimeComponentName,
  RuntimeConfiguration,
  RuntimeManifest
} from "./runtime-types.js";

export class RuntimeComponentStarter {
  private readonly ports = new PortAllocator();

  constructor(
    private readonly config: RuntimeConfiguration,
    private readonly store: RuntimeManifestStore,
    private readonly processes: RuntimeProcessManager,
    private readonly inspector: ProcessInspector,
    private readonly health: RuntimeHealth
  ) {}

  async prepare(): Promise<void> {
    await Promise.all([
      mkdir(this.config.runtimeRoot, { recursive: true, mode: 0o700 }),
      mkdir(join(this.config.runtimeRoot, "logs"), { recursive: true, mode: 0o700 }),
      mkdir(join(this.config.dataRoot, "temporal"), { recursive: true, mode: 0o700 })
    ]);
    const database = NodraSqliteDatabase.open(this.config.databaseFile);
    try {
      await migrateDatabase(
        database,
        resolve(this.config.repositoryRoot, "packages/adapters/drizzle")
      );
    } finally {
      database.close();
    }
  }

  async temporal(manifest: RuntimeManifest): Promise<RuntimeComponentManifest> {
    const requestedPort = this.config.temporalAddress
      ? Number(this.config.temporalAddress.split(":")[1])
      : 7233;
    const requestedAddress = `127.0.0.1:${requestedPort}`;
    const existing = await this.health.temporal(requestedAddress, this.config.temporalNamespace);
    if (existing.ready) {
      return this.external("temporal", requestedAddress, requestedPort, null, existing.detail);
    }
    if (this.config.temporalAddress && !await this.ports.available(requestedPort)) {
      throw new Error(`Temporal override ${requestedAddress} is occupied but not healthy`);
    }
    const port = await this.ports.free(this.config.temporalAddress ? requestedPort : 7233);
    const address = `127.0.0.1:${port}`;
    const logFile = this.logFile("temporal");
    const identity = await this.processes.start({
      executable: this.config.temporalBinary,
      arguments: [
        "--disable-config-file",
        "--disable-config-env",
        "server",
        "start-dev",
        "--headless",
        "--ip",
        "127.0.0.1",
        "--port",
        String(port),
        "--namespace",
        this.config.temporalNamespace,
        "--db-filename",
        join(this.config.dataRoot, "temporal/dev-server.db")
      ],
      environment: this.baseEnvironment(manifest, { NODRA_TEMPORAL_ADDRESS: address }),
      logFile
    });
    const component = await this.recordStarting(
      manifest,
      this.managed("temporal", identity, address, port, null, logFile),
      "started; waiting for Temporal namespace readiness"
    );
    await this.health.wait(
      () => this.health.temporal(address, this.config.temporalNamespace),
      "Temporal"
    );
    return { ...component, health: "ready", detail: "managed by Nodra" };
  }

  async opencode(manifest: RuntimeManifest): Promise<RuntimeComponentManifest> {
    const requestedUrl = this.config.opencodeUrl ?? "http://127.0.0.1:4096";
    const requestedPort = Number(new URL(requestedUrl).port || "80");
    const existing = await this.health.opencode(requestedUrl);
    if (existing.ready) {
      return this.external("opencode", null, requestedPort, requestedUrl, existing.detail);
    }
    if (this.config.opencodeUrl && !await this.ports.available(requestedPort)) {
      throw new Error(`OpenCode override ${requestedUrl} is occupied but not healthy`);
    }
    const port = await this.ports.free(this.config.opencodeUrl ? requestedPort : 4096);
    const url = `http://127.0.0.1:${port}`;
    const logFile = this.logFile("opencode");
    const environment = this.baseEnvironment(manifest, { NODRA_OPENCODE_URL: url });
    if (this.config.profile === "local") {
      environment.OPENCODE_CONFIG = await this.writeLocalOpenCodeConfig();
    } else if (this.config.opencodeConfigFile) {
      environment.OPENCODE_CONFIG = this.config.opencodeConfigFile;
    }
    const identity = await this.processes.start({
      executable: this.config.opencodeBinary,
      arguments: [
        "serve",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
        "--pure",
        "--print-logs"
      ],
      environment,
      logFile
    });
    const component = await this.recordStarting(
      manifest,
      this.managed("opencode", identity, null, port, url, logFile),
      "started; waiting for OpenCode health and catalogue"
    );
    await this.health.wait(
      async () => {
        const result = await this.health.opencode(url);
        return { ready: result.ready, detail: result.detail };
      },
      "OpenCode Serve"
    );
    return { ...component, health: "ready", detail: "managed by Nodra" };
  }

  async api(manifest: RuntimeManifest): Promise<RuntimeComponentManifest> {
    const requestedUrl = this.config.apiUrl ?? "http://127.0.0.1:4100";
    const requestedPort = Number(new URL(requestedUrl).port || "80");
    const existing = await this.health.api(requestedUrl);
    if (existing.ready) {
      return this.external("api", null, requestedPort, requestedUrl, existing.detail);
    }
    if (this.config.apiUrl && !await this.ports.available(requestedPort)) {
      throw new Error(`API override ${requestedUrl} is occupied but not a healthy Nodra API`);
    }
    const port = await this.ports.free(this.config.apiUrl ? requestedPort : 4100);
    const url = `http://127.0.0.1:${port}`;
    const logFile = this.logFile("api");
    const identity = await this.processes.start({
      executable: this.config.tsxBinary,
      arguments: [
        "--tsconfig",
        resolve(this.config.repositoryRoot, "apps/api/tsconfig.json"),
        resolve(this.config.repositoryRoot, "apps/api/src/main.ts")
      ],
      environment: this.baseEnvironment(manifest, {
        HOST: "127.0.0.1",
        PORT: String(port),
        NODRA_API_URL: url
      }),
      logFile
    });
    const component = await this.recordStarting(
      manifest,
      this.managed("api", identity, null, port, url, logFile),
      "started; waiting for API/SQLite/Temporal health"
    );
    await this.health.wait(() => this.health.api(url), "Nodra API");
    return { ...component, health: "ready", detail: "managed by Nodra" };
  }

  async worker(manifest: RuntimeManifest): Promise<RuntimeComponentManifest> {
    const readinessFile = join(this.config.runtimeRoot, "worker-ready.json");
    await rm(readinessFile, { force: true });
    const logFile = this.logFile("worker");
    const identity = await this.processes.start({
      executable: this.config.tsxBinary,
      arguments: [
        "--tsconfig",
        resolve(this.config.repositoryRoot, "apps/worker/tsconfig.json"),
        resolve(this.config.repositoryRoot, "apps/worker/src/main.ts")
      ],
      environment: this.baseEnvironment(manifest, {
        NODRA_WORKER_READY_FILE: readinessFile
      }),
      logFile
    });
    const component = await this.recordStarting(
      manifest,
      this.managed("worker", identity, null, null, null, logFile),
      "started; waiting for Temporal poller readiness"
    );
    await this.health.wait(
      () => this.health.worker(readinessFile, identity.pid),
      "Temporal worker"
    );
    return { ...component, health: "ready", detail: "managed by Nodra" };
  }

  async diagnostics(): Promise<string> {
    const sections: string[] = [];
    for (const name of ["temporal", "opencode", "api", "worker"] as const) {
      const content = await readFile(this.logFile(name), "utf8").catch(() => "");
      if (content) sections.push(`${name} log tail:\n${content.slice(-2_000)}`);
    }
    return sections.join("\n");
  }

  private async recordStarting(
    manifest: RuntimeManifest,
    component: RuntimeComponentManifest,
    detail: string
  ): Promise<RuntimeComponentManifest> {
    component.health = "degraded";
    component.detail = detail;
    manifest.components[component.name] = component;
    manifest.updatedAt = new Date().toISOString();
    await this.store.write(manifest);
    return component;
  }

  private async writeLocalOpenCodeConfig(): Promise<string> {
    const file = join(this.config.runtimeRoot, "opencode-local.json");
    const value = {
      $schema: "https://opencode.ai/config.json",
      model: `ollama/${this.config.localModel}`,
      enabled_providers: ["ollama"],
      provider: {
        ollama: {
          npm: "@ai-sdk/openai-compatible",
          name: "Ollama local Nodra runtime",
          options: { baseURL: `${this.config.ollamaUrl}/v1` },
          models: {
            [this.config.localModel]: { name: this.config.localModel }
          }
        }
      }
    };
    await writeFile(file, JSON.stringify(value, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600
    });
    return file;
  }

  private baseEnvironment(
    manifest: RuntimeManifest,
    overrides: NodeJS.ProcessEnv = {}
  ): NodeJS.ProcessEnv {
    return {
      ...process.env,
      NODRA_DATA_ROOT: this.config.dataRoot,
      NODRA_DATABASE_FILE: this.config.databaseFile,
      NODRA_RUNTIME_ROOT: this.config.runtimeRoot,
      NODRA_TEMPORAL_ADDRESS: manifest.components.temporal.address
        ?? this.config.temporalAddress
        ?? "127.0.0.1:7233",
      NODRA_TEMPORAL_NAMESPACE: this.config.temporalNamespace,
      NODRA_OPENCODE_URL: manifest.components.opencode.url
        ?? this.config.opencodeUrl
        ?? "http://127.0.0.1:4096",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      ...overrides
    };
  }

  private managed(
    name: RuntimeComponentName,
    identity: NonNullable<RuntimeComponentManifest["identity"]>,
    address: string | null,
    port: number | null,
    url: string | null,
    logFile: string
  ): RuntimeComponentManifest {
    return {
      name,
      ownership: "managed",
      identity,
      address,
      port,
      url,
      logFile,
      health: "ready",
      detail: "managed by Nodra"
    };
  }

  private external(
    name: RuntimeComponentName,
    address: string | null,
    port: number,
    url: string | null,
    detail: string
  ): RuntimeComponentManifest {
    return {
      name,
      ownership: "external",
      identity: this.inspector.listener(port),
      address,
      port,
      url,
      logFile: null,
      health: "ready",
      detail
    };
  }

  private logFile(component: RuntimeComponentName): string {
    return join(this.config.runtimeRoot, "logs", `${component}.jsonl`);
  }
}
