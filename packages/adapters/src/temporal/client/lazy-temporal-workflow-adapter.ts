import type { StartMissionInput, WorkflowPort, WorkflowQuery, WorkflowSignal, WorkflowUpdate } from "@nodra/application";
import type { LazyTemporalConnection } from "./lazy-temporal-connection.js";
import { TemporalWorkflowAdapter } from "./temporal-workflow-adapter.js";

export class LazyTemporalWorkflowAdapter implements WorkflowPort {
  constructor(private readonly connection: LazyTemporalConnection) {}

  async start(input: StartMissionInput): Promise<{ workflowId: string; runId: string }> {
    return (await this.adapter()).start(input);
  }

  async signal(id: string, signal: WorkflowSignal): Promise<void> {
    return (await this.adapter()).signal(id, signal);
  }

  async update<T>(id: string, update: WorkflowUpdate): Promise<T> {
    return (await this.adapter()).update(id, update);
  }

  async query<T>(id: string, query: WorkflowQuery): Promise<T> {
    return (await this.adapter()).query(id, query);
  }

  private async adapter(): Promise<TemporalWorkflowAdapter> {
    return new TemporalWorkflowAdapter(await this.connection.client());
  }
}
