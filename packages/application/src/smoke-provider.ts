import { randomUUID } from "node:crypto";
import { DomainError, asId } from "@nodra/domain";
import type { ProviderCatalogRepository } from "./provider-catalog-repository.js";
import type {
  ProviderEventInput,
  ProviderReasoningEffort,
  ProviderSmokeResult
} from "./provider-model.js";
import type { ProviderRegistry } from "./provider-registry.js";

const marker = "NODRA_SMOKE_OK";
const prompt = "Reply with exactly NODRA_SMOKE_OK. Do not use tools.";
const messageLimit = 160;

export interface SmokeProviderInput {
  providerId: string;
  modelId: string;
  reasoningEffort?: string;
  cwd: string;
  allowTurn: boolean;
}

export class SmokeProvider {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly catalog: ProviderCatalogRepository,
    private readonly timeoutMs = 120_000
  ) {}

  async execute(input: SmokeProviderInput): Promise<ProviderSmokeResult> {
    if (!input.allowTurn) {
      throw new DomainError(
        "Provider smoke creates one real thread and turn; pass --allow-turn explicitly",
        "PROVIDER_SMOKE_OPT_IN_REQUIRED"
      );
    }
    const provider = this.providers.resolve(input.providerId);
    const snapshot = await this.catalog.latest(input.providerId);
    if (!snapshot) {
      throw new DomainError(
        `Provider ${input.providerId} has no persisted probe snapshot`,
        "CAPABILITY_UNAVAILABLE"
      );
    }
    if (!snapshot.capabilities.start.available) {
      throw new DomainError(
        snapshot.capabilities.start.reason ?? "Provider start is unavailable",
        "CAPABILITY_UNAVAILABLE"
      );
    }
    const model = snapshot.models.find((candidate) => candidate.id === input.modelId);
    if (!model) {
      throw new DomainError(
        `Model ${input.modelId} was not returned by the persisted provider probe`,
        "CAPABILITY_UNAVAILABLE"
      );
    }
    const reasoningEffort = this.resolveEffort(input.reasoningEffort, model.supportedReasoningEfforts);
    const events: ProviderEventInput[] = [];
    const runId = asId(`provider-smoke/${randomUUID()}`);
    const execution = provider.execute({
      runId,
      providerId: input.providerId,
      modelId: input.modelId,
      reasoningEffort,
      prompt,
      cwd: input.cwd,
      permissionPreset: "read_only",
      capabilityVersion: snapshot.capabilities.version,
      contractStatus: snapshot.capabilities.contract.status,
      session: null
    }, {
      session: async () => undefined,
      runRef: async () => undefined,
      event: async (event) => { events.push(event); },
      permission: async () => {
        throw new DomainError(
          "Provider smoke requested a permission despite its no-tools prompt",
          "PROVIDER_SMOKE_TOOL_REQUESTED"
        );
      }
    });
    let result;
    try {
      result = await this.withTimeout(execution, runId, provider);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "Provider smoke protocol failed before a valid terminal event",
        "PROVIDER_SMOKE_PROTOCOL_FAILED"
      );
    }
    if (result.state !== "SUCCEEDED") {
      throw new DomainError(
        `Provider smoke reached terminal state ${result.state}`,
        "PROVIDER_SMOKE_TERMINAL_FAILED"
      );
    }
    if (events.some((event) => event.toolActivity)) {
      throw new DomainError(
        "Provider smoke used a tool despite its no-tools prompt",
        "PROVIDER_SMOKE_TOOL_USED"
      );
    }
    const assistantMessages = events.flatMap((event) =>
      event.assistantMessage === undefined ? [] : [event.assistantMessage]
    );
    const message = assistantMessages.find((value) => value.trim() === marker);
    if (!message) {
      throw new DomainError(
        "Provider smoke completed without the exact NODRA_SMOKE_OK assistant marker",
        "PROVIDER_SMOKE_MARKER_MISSING"
      );
    }
    return {
      provider: input.providerId,
      model: input.modelId,
      effort: reasoningEffort,
      terminalState: result.state,
      message: message.slice(0, messageLimit),
      events: [...new Set(events.map((event) => event.type))].slice(0, 20)
    };
  }

  private resolveEffort(
    requested: string | undefined,
    supported: ProviderReasoningEffort[]
  ): ProviderReasoningEffort {
    if (requested === undefined) return "provider_default";
    const known: ProviderReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh"];
    if (!known.includes(requested as ProviderReasoningEffort) || !supported.includes(
      requested as ProviderReasoningEffort
    )) {
      throw new DomainError(
        `Reasoning effort ${requested} was not returned for the selected model`,
        "CAPABILITY_UNAVAILABLE"
      );
    }
    return requested as ProviderReasoningEffort;
  }

  private async withTimeout<T>(
    execution: Promise<T>,
    runId: ReturnType<typeof asId>,
    provider: ReturnType<ProviderRegistry["resolve"]>
  ): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    const expired = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new DomainError(
          "Provider smoke did not reach a terminal event before timeout",
          "PROVIDER_SMOKE_TERMINAL_TIMEOUT"
        ));
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([execution, expired]);
    } catch (error) {
      if (error instanceof DomainError && error.code === "PROVIDER_SMOKE_TERMINAL_TIMEOUT") {
        await provider.cancel(runId).catch(() => undefined);
        void execution.catch(() => undefined);
      }
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
