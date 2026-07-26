import type { Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type { WorkspaceGitSnapshot } from "./workspace-model.js";
import type { WorkspacePort } from "./workspace-port.js";
import type { WorkspaceRepository } from "./workspace-repository.js";

export class SnapshotWorkspace {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly workspace: WorkspacePort
  ) {}
  async execute(input: {
    workspaceId: Id;
    snapshotId: Id;
    reason: string;
    context: CommandContext;
  }): Promise<WorkspaceGitSnapshot> {
    const record = await this.repository.read(input.workspaceId);
    const snapshot = await this.workspace.snapshot(record.path);
    return this.repository.saveSnapshot({
      id: input.snapshotId,
      workspaceId: input.workspaceId,
      reason: input.reason,
      snapshot,
      context: input.context
    });
  }
}
