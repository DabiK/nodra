import { DomainError, type Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import { ConfirmationRequiredError } from "./confirmation-required-error.js";
import type { ManageConfirmations } from "./manage-confirmations.js";
import type { IntegrationMethod, WorkspaceMutationResult } from "./workspace-model.js";
import type { WorkspacePort } from "./workspace-port.js";
import type { WorkspaceRepository } from "./workspace-repository.js";

export class IntegrateWorkspace {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly workspace: WorkspacePort,
    private readonly confirmations: ManageConfirmations
  ) {}

  async execute(input: {
    workspaceId: Id;
    method: IntegrationMethod;
    sourceRef: string;
    targetRef: string;
    confirmationId?: Id;
    context: CommandContext;
  }): Promise<WorkspaceMutationResult> {
    const replay = await this.repository.findCommand(input.context.commandId);
    if (replay) return { workspace: replay, before: null, after: null };
    if (!["merge", "rebase", "cherry-pick"].includes(input.method)) {
      throw new DomainError("Integration method is invalid", "REQUEST_INVALID");
    }
    if (!input.sourceRef.trim() || !input.targetRef.trim()) {
      throw new DomainError("Integration source and target refs are required", "REQUEST_INVALID");
    }
    const record = await this.repository.read(input.workspaceId);
    if (!record.repository || !["ready", "in_use"].includes(record.state)) {
      throw new DomainError("Workspace cannot be integrated", "WORKSPACE_STATE_CONFLICT");
    }
    const target = {
      method: input.method,
      sourceRef: input.sourceRef,
      targetRef: input.targetRef,
      workspaceId: input.workspaceId
    };
    if (!input.confirmationId) {
      throw new ConfirmationRequiredError({
        action: "git.integrate",
        target,
        cwd: record.path,
        risk: "destructive",
        scope: "once",
        workspaceId: input.workspaceId
      });
    }
    await this.confirmations.consume({
      id: input.confirmationId,
      action: "git.integrate",
      target,
      cwd: record.path,
      scope: "once",
      workspaceId: input.workspaceId,
      context: input.context
    });
    const before = await this.workspace.snapshot(record.path);
    await this.workspace.integrate({
      path: record.path,
      method: input.method,
      sourceRef: input.sourceRef,
      targetRef: input.targetRef
    });
    const after = await this.workspace.snapshot(record.path);
    return this.repository.recordGitMutation({
      workspaceId: input.workspaceId,
      reason: `git.integrate.${input.method}`,
      beforeId: `${input.context.commandId}/before` as Id,
      before,
      afterId: `${input.context.commandId}/after` as Id,
      after,
      context: input.context
    });
  }
}
