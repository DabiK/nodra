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

  constructor(
    private readonly options: TemporalMissionWorkerOptions,
    private readonly activities: TemporalRunActivities
  ) {}

  async run(): Promise<void> {
    this.connection = await NativeConnection.connect({ address: this.options.address });
    this.worker = await Worker.create({
      connection: this.connection,
      namespace: this.options.namespace,
      taskQueue: MISSION_TASK_QUEUE,
      workflowsPath: this.options.workflowsPath,
      activities: { recordStarted: this.activities.recordStarted.bind(this.activities) }
    });
    await this.worker.run();
  }

  shutdown(): void {
    this.worker?.shutdown();
  }

  async close(): Promise<void> {
    await this.connection?.close();
  }
}
