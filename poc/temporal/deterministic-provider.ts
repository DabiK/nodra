import type {
  ProviderExecutionResult,
  ProviderExecutionSink,
  ProviderPort,
  ProviderProbeResult,
  ProviderRunConfiguration
} from "@nodra/application";

export class DeterministicProvider implements ProviderPort {
  readonly providerId = "i6-2-deterministic";
  private executions = 0;

  get executionCount(): number {
    return this.executions;
  }

  async probe(): Promise<ProviderProbeResult> {
    throw new Error("The I6.2 provider is harness-only and is never probed");
  }

  async execute(
    input: ProviderRunConfiguration,
    sink: ProviderExecutionSink
  ): Promise<ProviderExecutionResult> {
    this.executions += 1;
    const sessionId = `fixture-session/${input.runId}`;
    const providerRunId = `fixture-turn/${input.runId}`;
    await sink.session(sessionId);
    await sink.runRef(providerRunId);
    await sink.event({
      type: "turn/started",
      payload: { turn: { id: providerRunId, status: "inProgress" } },
      occurredAt: "2026-07-26T10:00:01.000Z"
    });
    await sink.event({
      type: "item/completed",
      payload: {
        item: {
          id: `fixture-answer/${input.runId}`,
          type: "agentMessage",
          text: "deterministic Temporal POC completed"
        }
      },
      occurredAt: "2026-07-26T10:00:02.000Z"
    });
    await sink.event({
      type: "turn/completed",
      payload: { turn: { id: providerRunId, status: "completed" } },
      occurredAt: "2026-07-26T10:00:03.000Z"
    });
    return {
      state: "SUCCEEDED",
      externalSessionId: sessionId,
      externalRunId: providerRunId
    };
  }

  async cancel(_runId: string): Promise<void> {}

  async steer(_runId: string, _text: string): Promise<void> {}
}
