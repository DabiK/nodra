import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ProcessInspector } from "./process-inspector.js";
import { RuntimeComponentStarter } from "./runtime-component-starter.js";
import { RuntimeError } from "./runtime-errors.js";
import { RuntimeHealth } from "./runtime-health.js";
import { RuntimeManifestStore } from "./runtime-manifest-store.js";
import { RuntimeProcessManager } from "./runtime-process-manager.js";
import type {
  RuntimeComponentManifest,
  RuntimeComponentName,
  RuntimeConfiguration,
  RuntimeManifest,
  RuntimeStatus
} from "./runtime-types.js";

export class RuntimeSupervisor {
  private readonly store: RuntimeManifestStore;
  private readonly processes: RuntimeProcessManager;
  private readonly inspector = new ProcessInspector();
  private readonly health = new RuntimeHealth();
  private readonly starter: RuntimeComponentStarter;

  constructor(private readonly config: RuntimeConfiguration) {
    this.store = new RuntimeManifestStore(config.runtimeRoot);
    this.processes = new RuntimeProcessManager(config.repositoryRoot, this.inspector);
    this.starter = new RuntimeComponentStarter(
      config,
      this.store,
      this.processes,
      this.inspector,
      this.health
    );
  }

  start(): Promise<RuntimeStatus> {
    return this.store.withLock(async () => {
      const existing = await this.store.read();
      if (existing) {
        const current = await this.statusFor(existing);
        if (this.isIdempotentlyRunning(current)) return current;
        await this.stopValidated(existing);
        await this.store.archiveStale();
      }

      await this.starter.prepare();
      const manifest = this.emptyManifest();
      await this.store.write(manifest);
      try {
        manifest.components.temporal = await this.starter.temporal(manifest);
        await this.touch(manifest);
        manifest.components.opencode = await this.starter.opencode(manifest);
        await this.touch(manifest);
        manifest.components.api = await this.starter.api(manifest);
        await this.touch(manifest);
        manifest.components.worker = await this.starter.worker(manifest);
        await this.touch(manifest);
        return await this.statusFor(manifest);
      } catch (error) {
        const diagnostics = await this.starter.diagnostics();
        await this.stopValidated(manifest);
        await this.touch(manifest);
        throw new RuntimeError(
          `Runtime start failed and managed children were cleaned up: ${
            error instanceof Error ? error.message : String(error)
          }${diagnostics ? `\n${diagnostics}` : ""}`,
          "RUNTIME_START_FAILED"
        );
      }
    });
  }

  stop(): Promise<RuntimeStatus> {
    return this.store.withLock(async () => {
      const manifest = await this.store.read();
      if (!manifest) return this.emptyStatus();
      const mismatches = await this.stopValidated(manifest);
      if (mismatches.length === 0) {
        await this.store.remove();
        return this.emptyStatus();
      }
      manifest.updatedAt = new Date().toISOString();
      await this.store.write(manifest);
      return await this.statusFor(manifest);
    });
  }

  async status(): Promise<RuntimeStatus> {
    const manifest = await this.store.read();
    return manifest ? this.statusFor(manifest) : this.emptyStatus();
  }

  private async statusFor(manifest: RuntimeManifest): Promise<RuntimeStatus> {
    const components = await Promise.all(
      (["temporal", "opencode", "api", "worker"] as const)
        .map((name) => this.componentStatus(manifest, name))
    );
    const overall = components.every((component) => component.health === "ready")
      ? "ready"
      : components.some((component) => component.health === "stale")
        ? "stale"
        : "degraded";
    return {
      runtimeRoot: this.config.runtimeRoot,
      manifest,
      overall,
      components,
      environment: this.sessionEnvironment(manifest)
    };
  }

  private async componentStatus(
    manifest: RuntimeManifest,
    name: RuntimeComponentName
  ): Promise<RuntimeComponentManifest> {
    const component = manifest.components[name];
    if (
      component.ownership === "managed"
      && component.identity
      && !this.inspector.matches(component.identity)
    ) {
      return { ...component, health: "stale", detail: "PID/start-time/signature mismatch" };
    }
    if (name === "temporal" && component.address) {
      const result = await this.health.temporal(component.address, manifest.temporalNamespace);
      return { ...component, health: result.ready ? "ready" : "degraded", detail: result.detail };
    }
    if (name === "opencode" && component.url) {
      const result = await this.health.opencode(component.url);
      return { ...component, health: result.ready ? "ready" : "degraded", detail: result.detail };
    }
    if (name === "api" && component.url) {
      const result = await this.health.api(component.url);
      return { ...component, health: result.ready ? "ready" : "degraded", detail: result.detail };
    }
    if (name === "worker" && component.identity) {
      const result = await this.health.worker(
        join(this.config.runtimeRoot, "worker-ready.json"),
        component.identity.pid
      );
      return { ...component, health: result.ready ? "ready" : "degraded", detail: result.detail };
    }
    return component;
  }

  private async stopValidated(manifest: RuntimeManifest): Promise<RuntimeComponentName[]> {
    const mismatches: RuntimeComponentName[] = [];
    for (const name of ["api", "worker", "opencode", "temporal"] as const) {
      const component = manifest.components[name];
      if (component.ownership === "external" || !component.identity) continue;
      const result = await this.processes.stop(component.identity, this.config.stopTimeoutMs);
      if (result === "identity_mismatch") {
        component.health = "stale";
        component.detail = "Not stopped: PID/start-time/signature mismatch";
        mismatches.push(name);
      } else {
        component.health = "stopped";
        component.detail = "Managed process group stopped";
      }
    }
    return mismatches;
  }

  private isIdempotentlyRunning(status: RuntimeStatus): boolean {
    return status.components.every((component) =>
      component.health === "ready"
      && (component.ownership === "external" || component.identity !== null)
    );
  }

  private emptyManifest(): RuntimeManifest {
    const timestamp = new Date().toISOString();
    return {
      schemaVersion: 1,
      runtimeId: randomUUID(),
      repositoryRoot: this.config.repositoryRoot,
      runtimeRoot: this.config.runtimeRoot,
      dataRoot: this.config.dataRoot,
      databaseFile: this.config.databaseFile,
      profile: this.config.profile,
      temporalNamespace: this.config.temporalNamespace,
      createdAt: timestamp,
      updatedAt: timestamp,
      ownerPid: process.pid,
      components: {
        temporal: this.blank("temporal"),
        opencode: this.blank("opencode"),
        api: this.blank("api"),
        worker: this.blank("worker")
      }
    };
  }

  private emptyStatus(): RuntimeStatus {
    return {
      runtimeRoot: this.config.runtimeRoot,
      manifest: null,
      overall: "stopped",
      components: [
        this.blank("temporal"),
        this.blank("opencode"),
        this.blank("api"),
        this.blank("worker")
      ],
      environment: {}
    };
  }

  private blank(name: RuntimeComponentName): RuntimeComponentManifest {
    return {
      name,
      ownership: "managed",
      identity: null,
      address: null,
      port: null,
      url: null,
      logFile: null,
      health: "stopped",
      detail: "not started"
    };
  }

  private async touch(manifest: RuntimeManifest): Promise<void> {
    manifest.updatedAt = new Date().toISOString();
    await this.store.write(manifest);
  }

  private sessionEnvironment(manifest: RuntimeManifest): Record<string, string> {
    const temporal = manifest.components.temporal.address;
    const opencode = manifest.components.opencode.url;
    const api = manifest.components.api.url;
    return {
      NODRA_DATA_ROOT: manifest.dataRoot,
      NODRA_RUNTIME_ROOT: manifest.runtimeRoot,
      NODRA_DATABASE_FILE: manifest.databaseFile,
      NODRA_TEMPORAL_NAMESPACE: manifest.temporalNamespace,
      ...(temporal ? { NODRA_TEMPORAL_ADDRESS: temporal } : {}),
      ...(opencode ? { NODRA_OPENCODE_URL: opencode } : {}),
      ...(api ? { NODRA_API_URL: api } : {})
    };
  }

}
