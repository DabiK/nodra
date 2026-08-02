import { DomainError, type Id } from "@nodra/domain";
import type { MissionAuditView, MissionReadModel } from "./mission-repository.js";

/** Timeline d'audit d'une mission, du plus ancien au plus récent. */
export class ListMissionAudit {
  constructor(private readonly missions: MissionReadModel) {}

  async execute(id: Id): Promise<MissionAuditView[]> {
    const mission = await this.missions.show(id);
    if (!mission) throw new DomainError(`Mission ${id} was not found`, "MISSION_NOT_FOUND");
    return this.missions.audit(id);
  }
}
