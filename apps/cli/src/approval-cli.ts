import type { ManageApprovals } from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import type { I4CliHandler, I4CliRequest } from "./i4-cli.js";

export class ApprovalCli implements I4CliHandler {
  constructor(private readonly approvals: ManageApprovals) {}
  async execute({ command, args, context }: I4CliRequest) {
    if (command === "approval:show" && args.length === 1) return this.approvals.show(toId(args[0]!));
    if (command === "approval:decide" && args.length >= 4 && ["approved", "denied"].includes(args[1]!)) return this.approvals.decide({ id: toId(args[0]!), decision: args[1] as "approved"|"denied", actor: args[2]!, comment: args.slice(3).join(" "), context });
    if (command !== "approval:request" || args.length < 3) return undefined;
    const subjectKind = args[0]; const subjectId = toId(args[1]!); if (!subjectKind || !["run", "mission", "manager"].includes(subjectKind)) throw new DomainError("Invalid approval subject", "CLI_USAGE_ERROR");
    const subject = subjectKind === "run" ? { runId: subjectId } : subjectKind === "mission" ? { missionId: subjectId } : { managerId: subjectId };
    return this.approvals.request({ id: toId(randomUUID()), subject, kind: args.slice(2).join(" "), context });
  }
}
