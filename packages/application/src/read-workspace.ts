import type { Id } from "@nodra/domain";
import type { WorkspaceRecord } from "./workspace-model.js";
import type { WorkspaceRepository } from "./workspace-repository.js";

export class ReadWorkspace {
  constructor(private readonly repository: WorkspaceRepository) {}
  execute(id: Id): Promise<WorkspaceRecord> {
    return this.repository.read(id);
  }
}
