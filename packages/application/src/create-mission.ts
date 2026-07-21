import { Mission, type ExecutionKind, type Id, type MissionSnapshot } from "@nodra/domain";
import type { MissionRepository } from "./mission-repository.js";

export interface CreateMissionInput {
  id: Id;
  projectId?: Id | null;
  title: string;
  executionKind: ExecutionKind;
  now: string;
}

export class CreateMission {
  constructor(private readonly missions: MissionRepository) {}

  async execute(input: CreateMissionInput): Promise<MissionSnapshot> {
    const mission = Mission.create(input);
    await this.missions.save(mission, -1);
    return mission.snapshot();
  }
}
