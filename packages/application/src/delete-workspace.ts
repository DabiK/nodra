import { DomainError, type Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import { ConfirmationRequiredError } from "./confirmation-required-error.js";
import { targetDigest } from "./exact-target.js";
import type { WorkspaceRecord } from "./workspace-model.js";
import type { WorkspacePort } from "./workspace-port.js";
import type { WorkspaceDeletionReservation } from "./workspace-deletion-reservation.js";
import type { WorkspaceRepository } from "./workspace-repository.js";

export class DeleteWorkspace {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly workspace: WorkspacePort,
    private readonly deletionReservation: WorkspaceDeletionReservation
  ) {}

  async execute(input: {
    workspaceId: Id;
    confirmationId?: Id;
    context: CommandContext;
  }): Promise<WorkspaceRecord> {
    const replay = await this.repository.findCommand(input.context.commandId);
    const record = replay?.id === input.workspaceId &&
      (replay.state === "pending_delete" || replay.state === "deleted")
      ? replay
      : await this.repository.assertDeletable(input.workspaceId);
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
    await this.deletionReservation.reserve({
      confirmationId: input.confirmationId,
      action: "workspace.delete",
      targetDigest: targetDigest(target),
      cwd: record.path,
      scope: "once",
      workspaceId: input.workspaceId,
      context: input.context
    });
    const reserved = await this.repository.read(input.workspaceId);
    if (reserved.state === "deleted") return reserved;
    if (reserved.kind === "repo") {
      throw new DomainError("Repository workspaces are never deleted by I5", "WORKSPACE_STATE_CONFLICT");
    }
    await this.workspace.deleteActivity({ path: reserved.path, kind: reserved.kind });
    return this.repository.completeDeletion({ workspaceId: input.workspaceId, context: input.context });
  }
}
