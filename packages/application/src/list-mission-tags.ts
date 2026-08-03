import { DomainError, type Id } from "@nodra/domain";
import type { MissionReadModel } from "./mission-repository.js";
import type { MissionTagView, TagRepository } from "./tag-repository.js";

/** Tags attachés à une mission, triés par libellé. */
export class ListMissionTags {
  constructor(
    private readonly repository: TagRepository,
    private readonly missions: MissionReadModel
  ) {}

  async execute(missionId: Id): Promise<MissionTagView[]> {
    const mission = await this.missions.show(missionId);
    if (!mission) throw new DomainError(`Mission ${missionId} was not found`, "MISSION_NOT_FOUND");
    return this.repository.tagsForMission(missionId);
  }
}
