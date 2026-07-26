import type {
  ProviderExecutionResult,
  ProviderExecutionSink,
  ProviderProbeResult,
  ProviderRunConfiguration
} from "./provider-model.js";

export interface ProviderPort {
  readonly providerId: string;
  probe(): Promise<ProviderProbeResult>;
  execute(input: ProviderRunConfiguration, sink: ProviderExecutionSink): Promise<ProviderExecutionResult>;
  cancel(runId: string): Promise<void>;
  steer(runId: string, text: string): Promise<void>;
}
