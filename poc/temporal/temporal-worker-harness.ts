import {
  TemporalMissionWorker,
  type TemporalRunActivities
} from "@nodra/adapters";

export class TemporalWorkerHarness {
  private active:
    | { worker: TemporalMissionWorker; completion: Promise<void> }
    | undefined;

  constructor(
    private readonly address: string,
    private readonly namespace: string,
    private readonly workflowsPath: string,
    private readonly activities: TemporalRunActivities
  ) {}

  start(): void {
    if (this.active) throw new Error("Temporal POC worker is already active");
    const worker = new TemporalMissionWorker({
      address: this.address,
      namespace: this.namespace,
      workflowsPath: this.workflowsPath
    }, this.activities);
    this.active = { worker, completion: worker.run() };
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    const { worker, completion } = this.active;
    worker.shutdown();
    await completion;
    await worker.close();
    this.active = undefined;
  }

  async forceCleanup(): Promise<void> {
    if (!this.active) return;
    const { worker, completion } = this.active;
    worker.shutdown();
    await completion.catch(() => undefined);
    await worker.close().catch(() => undefined);
    this.active = undefined;
  }
}
