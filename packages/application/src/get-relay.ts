import type { MissionListFilter, MissionReadModel, RelayProjection } from "./mission-repository.js";

export class GetRelay {
  constructor(private readonly missions: MissionReadModel) {}

  execute(filter?: MissionListFilter): Promise<RelayProjection> {
    return this.missions.relay(filter);
  }
}
