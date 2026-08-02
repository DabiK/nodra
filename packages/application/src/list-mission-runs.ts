import { DomainError, type Id } from "@nodra/domain";
import type { MissionReadModel, MissionRunsView } from "./mission-repository.js";

export class ListMissionRuns {
  constructor(private readonly missions: MissionReadModel) {}

  async execute(id: Id): Promise<MissionRunsView> {
    const mission = await this.missions.show(id);
    if (!mission) throw new DomainError(`Mission ${id} was not found`, "MISSION_NOT_FOUND");
    return this.missions.runs(id);
  }
}
