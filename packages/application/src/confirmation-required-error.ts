import { DomainError, type Id } from "@nodra/domain";
import type { ConfirmationScope } from "./confirmation-model.js";
import { canonicalTarget, targetDigest } from "./exact-target.js";

export interface ConfirmationRequestMetadata {
  action: string;
  target: object;
  targetJson: string;
  targetDigest: string;
  cwd: string | null;
  risk: string;
  scope: ConfirmationScope;
  runId: Id | null;
  missionId: Id | null;
  workspaceId: Id | null;
}

export class ConfirmationRequiredError extends DomainError {
  readonly confirmation: ConfirmationRequestMetadata;

  constructor(input: {
    action: string;
    target: object;
    cwd: string | null;
    risk: string;
    scope: ConfirmationScope;
    runId?: Id | null;
    missionId?: Id | null;
    workspaceId?: Id | null;
  }) {
    super(`An exact ${input.action} confirmation is required`, "CONFIRMATION_REQUIRED");
    this.confirmation = {
      action: input.action,
      target: input.target,
      targetJson: canonicalTarget(input.target),
      targetDigest: targetDigest(input.target),
      cwd: input.cwd,
      risk: input.risk,
      scope: input.scope,
      runId: input.runId ?? null,
      missionId: input.missionId ?? null,
      workspaceId: input.workspaceId ?? null
    };
  }
}
