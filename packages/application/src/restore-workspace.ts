import type { Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type { WorkspaceRecord } from "./workspace-model.js";
import type { WorkspacePort } from "./workspace-port.js";
import type { WorkspaceRepository } from "./workspace-repository.js";

export class RestoreWorkspace {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly workspace: Pick<WorkspacePort, "canonicalizeExisting">
  ) {}
  async execute(input: {
    workspaceId: Id;
    context: CommandContext;
  }): Promise<WorkspaceRecord> {
    const record = await this.repository.read(input.workspaceId);
    await this.workspace.canonicalizeExisting(record.path);
    return this.repository.restore(input);
  }
}
