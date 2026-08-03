import { DomainError } from "@nodra/domain";
import type { ManagerReadModel, ManagerTimelineFilter, ManagerTimelineView } from "./manager-repository.js";

export class ListManagerTimeline {
  constructor(private readonly managers: ManagerReadModel) {}

  async execute(filter: ManagerTimelineFilter = {}): Promise<ManagerTimelineView> {
    if (filter.managerId) {
      const manager = await this.managers.show(filter.managerId);
      if (!manager) throw new DomainError(`Manager ${filter.managerId} was not found`, "MANAGER_NOT_FOUND");
    }
    return this.managers.timeline(filter);
  }
}
