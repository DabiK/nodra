import { DomainError, type Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type { MissionExecutionRepository } from "./mission-execution-repository.js";
import type { MissionRepository } from "./mission-repository.js";
import type { RuntimeHealthProbe } from "./runtime-health-probe.js";

export interface StartMissionCommand {
  missionId: Id;
  expectedVersion: number;
  runId: Id;
  conversationId: Id;
  auditId: Id;
  outboxId: Id;
  context: CommandContext;
}

export interface StartMissionResult {
  commandId: Id;
  missionId: Id;
  runId: Id;
  workflowId: string;
  state: "ACTIVE";
  dispatchState: "pending";
}

export class StartMission {
  constructor(
    private readonly missions: MissionRepository,
    private readonly executions: MissionExecutionRepository,
    private readonly runtime: RuntimeHealthProbe
  ) {}

  async execute(command: StartMissionCommand): Promise<StartMissionResult> {
    const mission = await this.missions.load(command.missionId);
    if (!mission) throw new DomainError(`Mission ${command.missionId} was not found`, "MISSION_NOT_FOUND");
    if (mission.snapshot().version !== command.expectedVersion) {
      throw new DomainError("Mission version conflict", "MISSION_VERSION_CONFLICT");
    }

    mission.startAgent(command.context.occurredAt);
    await this.executions.validateStart(command.missionId);
    const runtime = await this.runtime.check();
    if (runtime.status !== "ok") {
      throw new DomainError("Temporal runtime is unavailable", "RUNTIME_UNHEALTHY");
    }

    const workflowId = `mission/${command.missionId}`;
    await this.executions.persistStart({
      mission,
      expectedVersion: command.expectedVersion,
      runId: command.runId,
      conversationId: command.conversationId,
      workflowId,
      auditId: command.auditId,
      outboxId: command.outboxId,
      context: command.context
    });
    return {
      commandId: command.context.commandId,
      missionId: command.missionId,
      runId: command.runId,
      workflowId,
      state: "ACTIVE",
      dispatchState: "pending"
    };
  }
}
