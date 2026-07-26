import type { Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type { ConfirmationScope } from "./confirmation-model.js";

export interface WorkspaceDeletionReservation {
  reserve(input: {
    workspaceId: Id;
    confirmationId: Id;
    action: string;
    targetDigest: string;
    cwd: string;
    scope: ConfirmationScope;
    context: CommandContext;
  }): Promise<void>;
}
