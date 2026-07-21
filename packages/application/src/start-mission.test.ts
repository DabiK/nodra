import { asId, Mission } from "@nodra/domain";
import type { DomainError } from "@nodra/domain";
import { describe, expect, it, vi } from "vitest";
import type { MissionExecutionRepository } from "./mission-execution-repository.js";
import type { MissionRepository } from "./mission-repository.js";
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
});
