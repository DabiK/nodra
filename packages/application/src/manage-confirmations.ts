import { DomainError, type Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type {
  ConfirmationRecord,
  ConfirmationRepository,
  ConfirmationScope
} from "./confirmation-model.js";
import { canonicalTarget, targetDigest } from "./exact-target.js";
import type { WorkspacePort } from "./workspace-port.js";

export class ManageConfirmations {
  constructor(
    private readonly repository: ConfirmationRepository,
    private readonly paths: Pick<WorkspacePort, "canonicalizeExisting">
  ) {}

  async request(input: {
    id: Id;
    action: string;
    target: object;
    cwd?: string | null;
    providerId?: string | null;
    permissionPreset?: "read_only" | "workspace" | "full_access" | null;
    risk: string;
    scope: ConfirmationScope;
    runId?: Id;
    missionId?: Id;
    workspaceId?: Id;
    expiresAt: string;
    context: CommandContext;
  }): Promise<ConfirmationRecord> {
    const subjects = [input.runId, input.missionId, input.workspaceId].filter(Boolean);
    const validSubject =
      input.scope === "once"
        ? subjects.length === 1
        : input.scope === "run"
          ? Boolean(input.runId) && subjects.length === 1
          : Boolean(input.missionId) && subjects.length === 1;
    const expiry = Date.parse(input.expiresAt);
    if (
      !input.action.trim() ||
      !input.risk.trim() ||
      !validSubject ||
      !Number.isFinite(expiry) ||
      expiry <= Date.parse(input.context.occurredAt)
    ) {
      throw new DomainError("Invalid exact confirmation", "CONFIRMATION_INVALID");
    }
    const cwd = input.cwd ? await this.paths.canonicalizeExisting(input.cwd) : null;
    const record: ConfirmationRecord = {
      id: input.id,
      action: input.action.trim(),
      targetJson: canonicalTarget(input.target),
      targetDigest: targetDigest(input.target),
      cwd,
      providerId: input.providerId ?? null,
      permissionPreset: input.permissionPreset ?? null,
      risk: input.risk.trim(),
      scope: input.scope,
      runId: input.runId ?? null,
      missionId: input.missionId ?? null,
      workspaceId: input.workspaceId ?? null,
      expiresAt: new Date(expiry).toISOString(),
      state: "pending",
      decidedBy: null,
      comment: null,
      createdAt: input.context.occurredAt,
      decidedAt: null,
      consumedAt: null
    };
    await this.repository.request(record, input.context);
    return record;
  }

  decide(input: {
    id: Id;
    decision: "approved" | "denied";
    actor: string;
    comment: string;
    context: CommandContext;
  }): Promise<ConfirmationRecord> {
    if (!input.actor.trim() || !input.comment.trim()) {
      throw new DomainError("Decision actor and comment are required", "CONFIRMATION_INVALID");
    }
    return this.repository.decide(input);
  }

  consume(input: {
    id: Id;
    action: string;
    target: object;
    cwd?: string | null;
    scope: ConfirmationScope;
    runId?: Id;
    missionId?: Id;
    workspaceId?: Id;
    context: CommandContext;
  }): Promise<ConfirmationRecord> {
    return this.repository.consume({
      id: input.id,
      action: input.action,
      targetDigest: targetDigest(input.target),
      cwd: input.cwd ?? null,
      scope: input.scope,
      runId: input.runId ?? null,
      missionId: input.missionId ?? null,
      workspaceId: input.workspaceId ?? null,
      context: input.context
    });
  }

  show(id: Id): Promise<ConfirmationRecord> {
    return this.repository.show(id);
  }
}
