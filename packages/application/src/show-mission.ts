import { DomainError, type Id } from "@nodra/domain";
import type { MissionReadModel, MissionView } from "./mission-repository.js";

export class ShowMission {
  constructor(private readonly missions: MissionReadModel) {}

  async execute(id: Id): Promise<MissionView> {
    const mission = await this.missions.show(id);
    if (!mission) throw new DomainError(`Mission ${id} was not found`, "MISSION_NOT_FOUND");
    return mission;
  }
}
