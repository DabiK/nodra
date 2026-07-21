import type { RuntimeHealthProbe } from "@nodra/application";
import { DomainError } from "@nodra/domain";
import { Connection, WorkflowClient } from "@temporalio/client";

export interface TemporalConnectionOptions {
  address: string;
  namespace: string;
  connectTimeoutMs?: number;
}

export class LazyTemporalConnection implements RuntimeHealthProbe {
  private connection: Connection | undefined;

  constructor(private readonly options: TemporalConnectionOptions) {}

  async client(): Promise<WorkflowClient> {
    try {
      const connection = await this.connect();
      return new WorkflowClient({ connection, namespace: this.options.namespace });
    } catch {
      throw new DomainError("Temporal runtime is unavailable", "RUNTIME_UNHEALTHY");
    }
  }

  async check(): Promise<{ status: "ok" | "error"; detail?: string }> {
    try {
      const connection = await this.connect();
      await connection.withDeadline(
        Date.now() + (this.options.connectTimeoutMs ?? 500),
        async () => {
          await connection.workflowService.getSystemInfo({});
          await connection.workflowService.describeNamespace({ namespace: this.options.namespace });
        }
      );
      return { status: "ok" };
    } catch {
      return { status: "error", detail: "Temporal runtime is unavailable" };
    }
  }

  async close(): Promise<void> {
    await this.connection?.close();
    this.connection = undefined;
  }

  private async connect(): Promise<Connection> {
    this.connection ??= await Connection.connect({
      address: this.options.address,
      connectTimeout: this.options.connectTimeoutMs ?? 500
    });
    return this.connection;
  }
}
