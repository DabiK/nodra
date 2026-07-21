import type { MissionListFilter, MissionReadModel, MissionView } from "./mission-repository.js";

export class ListMissions {
  constructor(private readonly missions: MissionReadModel) {}

  execute(filter?: MissionListFilter): Promise<MissionView[]> {
    return this.missions.list(filter);
  }
}
