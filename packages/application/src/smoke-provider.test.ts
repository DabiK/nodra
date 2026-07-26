import { describe, expect, it, vi } from "vitest";
import type { ProviderCatalogRepository } from "./provider-catalog-repository.js";
import type {
  ProviderCatalogSnapshot,
  ProviderExecutionSink,
  ProviderPort,
  ProviderRunConfiguration
} from "./index.js";
import { SmokeProvider } from "./smoke-provider.js";

const snapshot = (): ProviderCatalogSnapshot => ({
  providerId: "neutral",
  adapterVersion: "adapter-v1",
  binaryVersion: "provider/1",
  authenticated: true,
  authKind: "local",
  health: { status: "ready", reason: null, actionRequired: null },
  capabilities: {
    schemaVersion: 1,
    providerId: "neutral",
    version: "adapter-v1:provider/1",
    availability: { available: true, reason: null },
    authentication: { available: true, reason: null },
    models: { available: true, reason: null },
    contract: {
      available: true,
      reason: null,
      status: "certified",
      expectedVersion: "provider/1",
      currentVersion: "provider/1",
      action: null
    },
    start: { available: true, reason: null },
    events: { available: true, reason: null },
    cancel: { available: true, reason: null },
    resume: { available: true, reason: null },
    steer: { available: true, reason: null, mode: "immediate" },
    usage: { available: false, reason: "not_observed", kind: "none" },
    attachments: { available: false, reason: "not_supported" },
    mcp: { available: false, reason: "not_supported" },
    permissionInterception: { available: true, reason: null },
    optionsSchemaVersion: 1
  },
  models: [{
    id: "model-1",
    displayName: "Model",
    description: "",
    hidden: false,
    isDefault: true,
    supportedReasoningEfforts: ["low", "medium"],
    defaultReasoningEffort: "medium"
  }],
  probedAt: "2026-07-26T10:00:00.000Z",
  catalogVersion: "catalog-v1"
});

const catalog = (): ProviderCatalogRepository => ({
  save: vi.fn(),
  latest: vi.fn(async () => snapshot()),
  markIncompatible: vi.fn()
});

const provider = (
  execute: (input: ProviderRunConfiguration, sink: ProviderExecutionSink) =>
    ReturnType<ProviderPort["execute"]>
): ProviderPort => ({
  providerId: "neutral",
  probe: vi.fn(),
  execute: vi.fn(execute),
  cancel: vi.fn(),
  steer: vi.fn()
});

const input = {
  providerId: "neutral",
  modelId: "model-1",
  reasoningEffort: "low",
  cwd: "/safe/provider-smoke",
  allowTurn: true
};

describe("SmokeProvider", () => {
  it("uses the provider-neutral port with read-only configuration and validates marker plus terminal", async () => {
    let received: ProviderRunConfiguration | undefined;
    const adapter = provider(async (configuration, sink) => {
      received = configuration;
      await sink.event({
        type: "provider/message",
        payload: {},
        occurredAt: "2026-07-26T10:00:01.000Z",
        assistantMessage: "NODRA_SMOKE_OK"
      });
      await sink.event({
        type: "provider/terminal",
        payload: {},
        occurredAt: "2026-07-26T10:00:02.000Z"
      });
      return {
        state: "SUCCEEDED",
        externalSessionId: "session",
        externalRunId: "turn"
      };
    });

    await expect(new SmokeProvider(adapter, catalog()).execute(input)).resolves.toEqual({
      provider: "neutral",
      model: "model-1",
      effort: "low",
      terminalState: "SUCCEEDED",
      message: "NODRA_SMOKE_OK",
      events: ["provider/message", "provider/terminal"]
    });
    expect(received).toMatchObject({
      providerId: "neutral",
      modelId: "model-1",
      reasoningEffort: "low",
      cwd: "/safe/provider-smoke",
      permissionPreset: "read_only",
      prompt: "Reply with exactly NODRA_SMOKE_OK. Do not use tools.",
      session: null
    });
    expect(received?.runId).toEqual(expect.stringMatching(/^provider-smoke\//));
  });

  it("refuses an unknown model and an effort absent from the persisted snapshot", async () => {
    const adapter = provider(async () => ({
      state: "SUCCEEDED",
      externalSessionId: "session",
      externalRunId: "turn"
    }));
    await expect(new SmokeProvider(adapter, catalog()).execute({
      ...input,
      modelId: "missing"
    })).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
    await expect(new SmokeProvider(adapter, catalog()).execute({
      ...input,
      reasoningEffort: "high"
    })).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("fails clearly when the assistant marker or successful terminal is absent", async () => {
    const missingMarker = provider(async (_configuration, sink) => {
      await sink.event({
        type: "provider/message",
        payload: {},
        occurredAt: "2026-07-26T10:00:01.000Z",
        assistantMessage: "something else"
      });
      return {
        state: "SUCCEEDED",
        externalSessionId: "session",
        externalRunId: "turn"
      };
    });
    await expect(new SmokeProvider(missingMarker, catalog()).execute(input))
      .rejects.toMatchObject({ code: "PROVIDER_SMOKE_MARKER_MISSING" });

    const failed = provider(async () => ({
      state: "FAILED",
      externalSessionId: "session",
      externalRunId: "turn"
    }));
    await expect(new SmokeProvider(failed, catalog()).execute(input))
      .rejects.toMatchObject({ code: "PROVIDER_SMOKE_TERMINAL_FAILED" });
  });

  it("refuses a turn without the explicit opt-in", async () => {
    const adapter = provider(async () => ({
      state: "SUCCEEDED",
      externalSessionId: "session",
      externalRunId: "turn"
    }));
    await expect(new SmokeProvider(adapter, catalog()).execute({
      ...input,
      allowTurn: false
    })).rejects.toMatchObject({ code: "PROVIDER_SMOKE_OPT_IN_REQUIRED" });
    expect(adapter.execute).not.toHaveBeenCalled();
  });
});
