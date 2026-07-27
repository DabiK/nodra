import type { Id } from "@nodra/domain";
import type {
  ManagerConversationView,
  ManagerListFilter,
  ManagerReadModel,
  ManagerView
} from "./manager-repository.js";

export class ListManagers {
  constructor(private readonly managers: ManagerReadModel) {}

  execute(filter?: ManagerListFilter): Promise<ManagerView[]> {
    return this.managers.list(filter);
  }
}

export class ShowManager {
  constructor(private readonly managers: ManagerReadModel) {}

  execute(id: Id): Promise<ManagerView | null> {
    return this.managers.show(id);
  }
}

export class ListManagerConversations {
  constructor(private readonly managers: ManagerReadModel) {}

  execute(id: Id): Promise<ManagerConversationView[]> {
    return this.managers.conversations(id);
  }
}
