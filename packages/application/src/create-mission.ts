import { asId, Mission, type Id, type MissionSnapshot } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type { MissionRepository } from "./mission-repository.js";

export interface CreateMissionInput {
  id: Id;
  projectId?: Id | null;
  title: string;
  context: CommandContext;
}

export class CreateMission {
  constructor(private readonly missions: MissionRepository) {}

  async execute(input: CreateMissionInput): Promise<MissionSnapshot> {
    const mission = Mission.createHuman({
      id: input.id,
      title: input.title,
      now: input.context.occurredAt,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId })
    });
    const snapshot = mission.snapshot();
    const payload = {
      schemaVersion: 1,
      action: "create",
      fromState: null,
      toState: snapshot.state,
      missionVersion: snapshot.version,
      executionKind: snapshot.executionKind,
      projectId: snapshot.projectId
    } as const;
    await this.missions.save({
      mission,
      expectedVersion: -1,
      audit: {
        id: asId(`audit/${input.context.commandId}`),
        commandId: input.context.commandId,
        eventType: "MISSION_CREATED",
        actor: input.context.actor,
        payload,
        occurredAt: input.context.occurredAt
      },
      outbox: {
        id: asId(`outbox/${input.context.commandId}`),
        kind: "mission.changed",
        dedupeKey: `mission/${snapshot.id}/version/${snapshot.version}`,
        payload: { ...payload, missionId: snapshot.id },
        createdAt: input.context.occurredAt
      },
      relay: null
    });
    return snapshot;
  }
}
