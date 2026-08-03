import type { ActivityRepository, ActivityView } from "./activity-repository.js";

export class ListActivity {
  constructor(private readonly repository: ActivityRepository) {}

  execute(): Promise<ActivityView> {
    return this.repository.list();
  }
}
