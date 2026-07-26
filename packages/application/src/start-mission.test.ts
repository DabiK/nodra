import { asId, Mission } from "@nodra/domain";
import type { DomainError } from "@nodra/domain";
import { describe, expect, it, vi } from "vitest";
import type { MissionExecutionRepository } from "./mission-execution-repository.js";
import type { MissionRepository } from "./mission-repository.js";
import type { ProviderCatalogRepository } from "./provider-catalog-repository.js";
import type { ProviderCatalogSnapshot } from "./provider-model.js";
import { StartMission } from "./start-mission.js";

const command = {
  missionId: asId("mission-1"),
  expectedVersion: 1,
  runId: asId("run-1"),
  conversationId: asId("conversation-1"),
  auditId: asId("audit-1"),
  outboxId: asId("outbox-1"),
  context: { commandId: asId("command-1"), actor: "user" as const, occurredAt: "2026-07-22T10:00:00.000Z" }
};

const readyAgentMission = () => {
  const mission = Mission.create({
    id: command.missionId,
    title: "Agent mission",
    executionKind: "agent",
    now: "2026-07-22T09:00:00.000Z"
  });
  mission.prepare("2026-07-22T09:30:00.000Z");
  return mission;
};

const providerSnapshot = (
  status: "compatible_unverified" | "incompatible"
): ProviderCatalogSnapshot => {
  const available = { available: true, reason: null };
  const start = status === "incompatible"
    ? { available: false, reason: "protocol_incompatible" }
    : available;
  return {
    providerId: "provider-x",
    catalogVersion: `catalog-${status}`,
    adapterVersion: "adapter-v1",
    binaryVersion: "provider/2.0.0",
    authenticated: true,
    authKind: "local",
    health: {
      status: "degraded",
      reason: status === "incompatible"
        ? "protocol_incompatible"
        : "provider_binary_version_not_certified",
      actionRequired: "update_required"
    },
    probedAt: "2026-07-22T09:45:00.000Z",
    models: [{
      id: "model-1",
      displayName: "Model",
      description: "",
      hidden: false,
      isDefault: true,
      supportedReasoningEfforts: ["medium"],
      defaultReasoningEffort: "medium"
    }],
    capabilities: {
      schemaVersion: 1,
      providerId: "provider-x",
      version: "adapter-v1:provider/2.0.0",
      availability: available,
      authentication: available,
      models: available,
      contract: {
        ...start,
        status,
        expectedVersion: "provider/1.0.0",
        currentVersion: "provider/2.0.0",
        action: "review contract"
      },
      start,
      events: start,
      cancel: start,
      resume: start,
      steer: { ...start, mode: status === "incompatible" ? "none" : "immediate" },
      usage: { available: false, reason: "not_observed", kind: "none" },
      attachments: { available: false, reason: "not_supported" },
      mcp: { available: false, reason: "not_supported" },
      permissionInterception: start,
      optionsSchemaVersion: 1
    }
  };
};

describe("StartMission", () => {
  it("checks stable business errors before runtime health", async () => {
    const runtime = { check: vi.fn(async () => ({ status: "error" as const })) };
    const executions: MissionExecutionRepository = { validateStart: vi.fn(), persistStart: vi.fn() };
    const missing: MissionRepository = { load: vi.fn(async () => null), save: vi.fn() };
    await expect(new StartMission(missing, executions, runtime).execute(command)).rejects.toMatchObject({
      code: "MISSION_NOT_FOUND"
    });
    expect(runtime.check).not.toHaveBeenCalled();

    const stale: MissionRepository = { load: vi.fn(async () => readyAgentMission()), save: vi.fn() };
    await expect(new StartMission(stale, executions, runtime).execute({ ...command, expectedVersion: 0 }))
      .rejects.toMatchObject({ code: "MISSION_VERSION_CONFLICT" });
    expect(runtime.check).not.toHaveBeenCalled();
  });

  it("refuses a valid start with RUNTIME_UNHEALTHY before persistence", async () => {
    const missions: MissionRepository = { load: vi.fn(async () => readyAgentMission()), save: vi.fn() };
    const executions: MissionExecutionRepository = { validateStart: vi.fn(), persistStart: vi.fn() };
    const start = new StartMission(missions, executions, { check: async () => ({ status: "error" }) });
    await expect(start.execute(command)).rejects.toEqual(
      expect.objectContaining<Partial<DomainError>>({ code: "RUNTIME_UNHEALTHY" })
    );
    expect(executions.persistStart).not.toHaveBeenCalled();
  });

  it("allows compatible_unverified but blocks an observed incompatible consumer contract", async () => {
    const requested = {
      providerId: "provider-x",
      modelId: "model-1",
      reasoningEffort: "medium",
      providerOptionsSchemaVersion: 1,
      providerOptionsJson: "{}",
      attachmentsRequested: false,
      mcpRequested: false
    };
    const compatibleExecutions: MissionExecutionRepository = {
      validateStart: vi.fn(async () => requested),
      persistStart: vi.fn()
    };
    const compatibleCatalog = {
      latest: vi.fn(async () => providerSnapshot("compatible_unverified"))
    } as unknown as ProviderCatalogRepository;
    await expect(new StartMission(
      { load: vi.fn(async () => readyAgentMission()), save: vi.fn() },
      compatibleExecutions,
      { check: async () => ({ status: "ok" }) },
      compatibleCatalog
    ).execute(command)).resolves.toMatchObject({ state: "ACTIVE" });
    expect(compatibleExecutions.persistStart).toHaveBeenCalledOnce();

    const incompatibleExecutions: MissionExecutionRepository = {
      validateStart: vi.fn(async () => requested),
      persistStart: vi.fn()
    };
    const incompatibleCatalog = {
      latest: vi.fn(async () => providerSnapshot("incompatible"))
    } as unknown as ProviderCatalogRepository;
    await expect(new StartMission(
      { load: vi.fn(async () => readyAgentMission()), save: vi.fn() },
      incompatibleExecutions,
      { check: async () => ({ status: "ok" }) },
      incompatibleCatalog
    ).execute(command)).rejects.toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
      message: "protocol_incompatible"
    });
    expect(incompatibleExecutions.persistStart).not.toHaveBeenCalled();
  });
});
