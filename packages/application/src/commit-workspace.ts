import { DomainError, type Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import { ConfirmationRequiredError } from "./confirmation-required-error.js";
import type { ManageConfirmations } from "./manage-confirmations.js";
import type { WorkspaceMutationResult } from "./workspace-model.js";
import type { WorkspacePort } from "./workspace-port.js";
import type { WorkspaceRepository } from "./workspace-repository.js";

export class CommitWorkspace {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly workspace: WorkspacePort,
    private readonly confirmations: ManageConfirmations
  ) {}

  async execute(input: {
    workspaceId: Id;
    missionId: Id;
    message: string;
    confirmationId?: Id;
    context: CommandContext;
  }): Promise<WorkspaceMutationResult> {
    if (!input.message.trim()) throw new DomainError("Commit message is required", "REQUEST_INVALID");
    const replay = await this.repository.findCommand(input.context.commandId);
    if (replay) return { workspace: replay, before: null, after: null };
    const record = await this.repository.read(input.workspaceId);
    if (!record.repository || !["ready", "in_use"].includes(record.state)) {
      throw new DomainError("Workspace cannot be committed", "WORKSPACE_STATE_CONFLICT");
    }
    const target = {
      message: input.message.trim(),
      missionId: input.missionId,
      workspaceId: input.workspaceId
    };
    const autoCommit = await this.repository.missionAllowsAutoCommit(input.missionId, input.workspaceId);
    if (!autoCommit) {
      if (!input.confirmationId) {
        throw new ConfirmationRequiredError({
          action: "git.commit",
          target,
          cwd: record.path,
          risk: "write",
          scope: "mission",
          missionId: input.missionId
        });
      }
      await this.confirmations.consume({
        id: input.confirmationId,
        action: "git.commit",
        target,
        cwd: record.path,
        scope: "mission",
        missionId: input.missionId,
        context: input.context
      });
    }
    const before = await this.workspace.snapshot(record.path);
    await this.workspace.commit({ path: record.path, message: input.message.trim() });
    const after = await this.workspace.snapshot(record.path);
    return this.repository.recordGitMutation({
      workspaceId: input.workspaceId,
      reason: "git.commit",
      beforeId: `${input.context.commandId}/before` as Id,
      before,
      afterId: `${input.context.commandId}/after` as Id,
      after,
      context: input.context
    });
  }
}
