import { DomainError, type Id } from "@nodra/domain";
import type { ApprovalRecord, ApprovalRepository, ApprovalSubject } from "./approval-model.js";
import type { CommandContext } from "./command-context.js";

export class ManageApprovals {
  constructor(private readonly repository: ApprovalRepository) {}

  async request(input: { id: Id; subject: ApprovalSubject; kind: string; expiresAt?: string; context: CommandContext }) {
    if (!input.kind.trim()) throw new DomainError("Approval kind is required", "REQUEST_INVALID");
    if (input.expiresAt !== undefined && (!Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.parse(input.context.occurredAt))) {
      throw new DomainError("Approval expiry must be a future ISO timestamp", "REQUEST_INVALID");
    }
    const record: ApprovalRecord = {
      id: input.id,
      subject: input.subject,
      kind: input.kind,
      state: "pending",
      expiresAt: input.expiresAt === undefined ? null : new Date(input.expiresAt).toISOString(),
      decidedAt: null,
      decidedBy: null,
      decisionComment: null,
      createdAt: input.context.occurredAt
    };
    await this.repository.request(record, input.context);
    return record;
  }

  show(id: Id) { return this.repository.show(id); }

  decide(input: { id: Id; decision: "approved"|"denied"; actor: string; comment: string; context: CommandContext }) {
    if (!input.actor.trim() || !input.comment.trim()) {
      throw new DomainError("Approval actor and comment are required", "REQUEST_INVALID");
    }
    return this.repository.decide(input);
  }
}
