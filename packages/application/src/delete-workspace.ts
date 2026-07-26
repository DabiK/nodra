import { DomainError, type Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import { ConfirmationRequiredError } from "./confirmation-required-error.js";
import type { ManageConfirmations } from "./manage-confirmations.js";
import type { WorkspaceRecord } from "./workspace-model.js";
import type { WorkspacePort } from "./workspace-port.js";
import type { WorkspaceRepository } from "./workspace-repository.js";

export class DeleteWorkspace {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly workspace: WorkspacePort,
    private readonly confirmations: ManageConfirmations
  ) {}

  async execute(input: {
    workspaceId: Id;
    confirmationId?: Id;
    context: CommandContext;
  }): Promise<WorkspaceRecord> {
    const replay = await this.repository.findCommand(input.context.commandId);
    if (replay) return replay;
    const record = await this.repository.assertDeletable(input.workspaceId);
    if (record.kind === "repo") {
      throw new DomainError("Repository workspaces are never deleted by I5", "WORKSPACE_STATE_CONFLICT");
    }
    if (!input.confirmationId) {
      throw new ConfirmationRequiredError({
        action: "workspace.delete",
        target: { path: record.path, workspaceId: input.workspaceId },
        cwd: record.path,
        risk: "destructive",
        scope: "once",
        workspaceId: input.workspaceId
      });
    }
    const target = { path: record.path, workspaceId: input.workspaceId };
    await this.confirmations.consume({
      id: input.confirmationId,
      action: "workspace.delete",
      target,
      cwd: record.path,
      scope: "once",
      workspaceId: input.workspaceId,
      context: input.context
    });
    await this.workspace.deleteActivity({ path: record.path, kind: record.kind });
    return this.repository.tombstone({ workspaceId: input.workspaceId, context: input.context });
  }
}
