import { asId, DomainError, type Id, type Mission, type MissionSnapshot } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type { MissionRelayRecord, MissionRepository, RelayQueue } from "./mission-repository.js";

export type HumanMissionAction =
  | { type: "prepare" }
  | { type: "pickup" }
  | { type: "block"; reason: string }
  | { type: "resume" }
  | { type: "close" }
  | { type: "abandon" };

export interface ChangeMissionStateInput {
  missionId: Id;
  expectedVersion: number;
  action: HumanMissionAction;
  context: CommandContext;
}

const eventTypes: Record<HumanMissionAction["type"], string> = {
  prepare: "MISSION_PREPARED",
  pickup: "MISSION_PICKED_UP",
  block: "MISSION_BLOCKED",
  resume: "MISSION_RESUMED",
  close: "MISSION_CLOSED",
  abandon: "MISSION_ABANDONED"
};

const queueForState = (state: MissionSnapshot["state"]): RelayQueue | null => {
  if (state === "READY") return "ready";
  if (state === "ACTIVE") return "active";
  if (state === "BLOCKED") return "blocked";
  if (state === "VALIDATION") return "decision_required";
  return null;
};

export class ChangeMissionState {
  constructor(private readonly missions: MissionRepository) {}

  async execute(input: ChangeMissionStateInput): Promise<MissionSnapshot> {
    const mission = await this.missions.load(input.missionId);
    if (!mission) throw new DomainError(`Mission ${input.missionId} was not found`, "MISSION_NOT_FOUND");
    const before = mission.snapshot();
    if (before.version !== input.expectedVersion) {
      throw new DomainError("Mission version conflict", "MISSION_VERSION_CONFLICT");
    }
    this.apply(mission, input.action, input.context.occurredAt);
    const after = mission.snapshot();
    const reason = input.action.type === "block" ? input.action.reason.trim() : undefined;
    const payload = {
      schemaVersion: 1,
      action: input.action.type,
      fromState: before.state,
      toState: after.state,
      missionVersion: after.version,
      ...(reason === undefined ? {} : { reason })
    };
    const queue = queueForState(after.state);
    let relay: MissionRelayRecord | null = null;
    if (queue) {
      relay = {
        id: asId(`relay/mission/${after.id}`),
        queue,
        reasonCode: reason ?? `mission_${queue}`,
        createdAt: input.context.occurredAt
      };
    }
    await this.missions.save({
      mission,
      expectedVersion: input.expectedVersion,
      audit: {
        id: asId(`audit/${input.context.commandId}`),
        commandId: input.context.commandId,
        eventType: eventTypes[input.action.type],
        actor: input.context.actor,
        payload,
        occurredAt: input.context.occurredAt
      },
      outbox: {
        id: asId(`outbox/${input.context.commandId}`),
        kind: "mission.changed",
        dedupeKey: `mission/${after.id}/version/${after.version}`,
        payload: { ...payload, missionId: after.id },
        createdAt: input.context.occurredAt
      },
      relay
    });
    return after;
  }

  private apply(mission: Mission, action: HumanMissionAction, now: string): void {
    if (action.type === "prepare") mission.prepare(now);
    else if (action.type === "pickup") mission.pickup(now);
    else if (action.type === "block") mission.block(now, action.reason);
    else if (action.type === "resume") mission.resume(now);
    else if (action.type === "close") mission.close(now);
    else mission.abandon(now);
  }
}
