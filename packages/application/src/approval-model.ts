import type { Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";

export type ApprovalSubject = { runId: Id; missionId?: never; managerId?: never } |
  { runId?: never; missionId: Id; managerId?: never } |
  { runId?: never; missionId?: never; managerId: Id };
export interface ApprovalRecord {
  id: Id;
  subject: ApprovalSubject;
  kind: string;
  state: "pending" | "approved" | "denied" | "expired";
  expiresAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionComment: string | null;
  createdAt: string;
}
export interface ApprovalRepository {
  request(record: ApprovalRecord, context: CommandContext): Promise<void>;
  show(id: Id): Promise<ApprovalRecord>;
  decide(input: { id: Id; decision: "approved"|"denied"; actor: string; comment: string; context: CommandContext }): Promise<ApprovalRecord>;
}
