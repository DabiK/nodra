import { readFile } from "node:fs/promises";
import { LazyTemporalConnection } from "../../packages/adapters/src/temporal/client/lazy-temporal-connection.js";

export class RuntimeHealth {
  async temporal(address: string, namespace: string): Promise<{ ready: boolean; detail: string }> {
    const connection = new LazyTemporalConnection({
      address,
      namespace,
      connectTimeoutMs: 800
    });
    try {
      const result = await connection.check();
      return {
        ready: result.status === "ok",
        detail: result.status === "ok" ? `namespace ${namespace} reachable` : (result.detail ?? "unreachable")
      };
    } finally {
      await connection.close();
    }
  }

  async opencode(url: string): Promise<{ ready: boolean; detail: string; models: string[] }> {
    try {
      const [health, providers] = await Promise.all([
        this.fetchFirst([`${url}/global/health`, `${url}/api/health`]),
        fetch(`${url}/config/providers`, { signal: AbortSignal.timeout(1_500) })
      ]);
      if (!health.ok || !providers.ok) {
        return { ready: false, detail: `health=${health.status} catalogue=${providers.status}`, models: [] };
      }
      const payload = await providers.json() as {
        providers?: Array<{ id?: string; models?: Record<string, unknown> }>;
      };
      const models = (payload.providers ?? []).flatMap((provider) =>
        Object.keys(provider.models ?? {}).map((model) => `${provider.id}/${model}`)
      );
      return {
        ready: true,
        detail: `${models.length} model(s) catalogued`,
        models
      };
    } catch (error) {
      return { ready: false, detail: error instanceof Error ? error.message : String(error), models: [] };
    }
  }

  async api(url: string): Promise<{ ready: boolean; detail: string }> {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1_500) });
      const payload = await response.json() as {
        service?: string;
        components?: { sqlite?: { status?: string }; workflow?: { status?: string } };
      };
      const ready = response.ok
        && payload.service === "nodra"
        && payload.components?.sqlite?.status === "ok"
        && payload.components?.workflow?.status === "ok";
      return {
        ready,
        detail: ready
          ? "API, SQLite and Temporal health ready"
          : `HTTP ${response.status}; service=${payload.service ?? "unknown"}`
      };
    } catch (error) {
      return { ready: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async worker(readinessFile: string, expectedPid?: number): Promise<{ ready: boolean; detail: string }> {
    try {
      const payload = JSON.parse(await readFile(readinessFile, "utf8")) as {
        pid?: number;
        ownerPid?: number;
        taskQueue?: string;
        readyAt?: string;
      };
      const ready = payload.ownerPid === expectedPid && payload.taskQueue === "nodra.workflow";
      return {
        ready,
        detail: ready
          ? `polling nodra.workflow since ${payload.readyAt}`
          : "readiness identity does not match worker"
      };
    } catch (error) {
      return {
        ready: false,
        detail: (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "worker readiness file is absent"
          : String(error)
      };
    }
  }

  async wait(
    probe: () => Promise<{ ready: boolean; detail: string }>,
    label: string,
    timeoutMs = 15_000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let detail = "not probed";
    while (Date.now() < deadline) {
      const result = await probe();
      detail = result.detail;
      if (result.ready) return;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error(`${label} did not become ready: ${detail}`);
  }

  private async fetchFirst(urls: string[]): Promise<Response> {
    let last: Response | undefined;
    for (const url of urls) {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return response;
      last = response;
    }
    return last!;
  }
}
