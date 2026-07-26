import { NativeConnection, Worker } from "@temporalio/worker";
import type { TemporalRunActivities } from "../activities/temporal-run-activities.js";
import { MISSION_TASK_QUEUE } from "../temporal-settings.js";

export interface TemporalMissionWorkerOptions {
  address: string;
  namespace: string;
  workflowsPath: string;
}

export class TemporalMissionWorker {
  private connection?: NativeConnection;
  private worker?: Worker;
  private shutdownRequested = false;

  constructor(
    private readonly options: TemporalMissionWorkerOptions,
    private readonly activities: TemporalRunActivities
  ) {}

  get taskQueue(): string {
    return MISSION_TASK_QUEUE;
  }

  async run(onReady?: () => Promise<void>): Promise<void> {
    this.connection = await NativeConnection.connect({ address: this.options.address });
    this.worker = await Worker.create({
      connection: this.connection,
      namespace: this.options.namespace,
      taskQueue: MISSION_TASK_QUEUE,
      workflowsPath: this.options.workflowsPath,
      activities: {
        recordStarted: this.activities.recordStarted.bind(this.activities),
        recordTerminal: this.activities.recordTerminal.bind(this.activities),
        executeProvider: this.activities.executeProvider.bind(this.activities),
        steerProvider: this.activities.steerProvider.bind(this.activities)
      }
    });
    if (this.shutdownRequested) this.worker.shutdown();
    const execution = this.worker.run();
    await this.waitUntilPolling();
    await onReady?.();
    await execution;
  }

  shutdown(): void {
    this.shutdownRequested = true;
    this.worker?.shutdown();
  }

  async close(): Promise<void> {
    await this.connection?.close();
  }

  private async waitUntilPolling(): Promise<void> {
    if (!this.worker) throw new Error("Temporal worker was not created");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = this.worker.getStatus();
      if (
        status.runState === "RUNNING"
        && status.workflowPollerState === "POLLING"
        && status.activityPollerState === "POLLING"
      ) {
        return;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    throw new Error("Temporal worker did not enter polling readiness");
  }
}
