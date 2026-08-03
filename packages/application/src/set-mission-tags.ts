import { DomainError, type Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type { MissionReadModel } from "./mission-repository.js";
import type { TagRepository } from "./tag-repository.js";

/** Remplace l'ensemble des tags d'une mission (issue #23). */
export class SetMissionTags {
  constructor(
    private readonly repository: TagRepository,
    private readonly missions: MissionReadModel
  ) {}

  async execute(input: { missionId: Id; tagIds: Id[]; context: CommandContext }): Promise<void> {
    const mission = await this.missions.show(input.missionId);
    if (!mission) throw new DomainError(`Mission ${input.missionId} was not found`, "MISSION_NOT_FOUND");
    const tagIds = [...new Set(input.tagIds)];
    if (tagIds.length > 0) {
      const missing = await this.repository.missingTagIds(tagIds);
      if (missing.length > 0) {
        throw new DomainError(`Tags not found: ${missing.join(", ")}`, "TAG_NOT_FOUND");
      }
    }
    await this.repository.setMissionTags({ missionId: input.missionId, tagIds, context: input.context });
  }
}
