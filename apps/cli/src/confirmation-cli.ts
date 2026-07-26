import type { ManageConfirmations } from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import type { I4CliHandler, I4CliRequest } from "./i4-cli.js";

export class ConfirmationCli implements I4CliHandler {
  constructor(private readonly confirmations: ManageConfirmations) {}

  async execute(request: I4CliRequest): Promise<unknown | undefined> {
    if (request.command === "confirmation:show") {
      if (request.args.length !== 1 || !request.args[0]) this.usage();
      return this.confirmations.show(toId(request.args[0] as string));
    }
    if (request.command === "confirmation:decide") {
      const [id, decision, actor, ...comment] = request.args;
      if (!id || !actor || (decision !== "approved" && decision !== "denied") || !comment.join(" ").trim()) {
        this.usage();
      }
      return this.confirmations.decide({
        id: toId(id as string),
        decision: decision as "approved" | "denied",
        actor: actor as string,
        comment: comment.join(" "),
        context: request.context
      });
    }
    if (request.command === "confirmation:request") return this.request(request);
    return undefined;
  }

  private request(request: I4CliRequest) {
    const values = [...request.args];
    const cwd = this.option(values, "--cwd");
    const [action, risk, scope, subjectType, subjectId, expiresAt, targetJson] = values;
    if (
      !action || !risk || !subjectId || !expiresAt || !targetJson ||
      !["once", "run", "mission"].includes(scope ?? "") ||
      !["run", "mission", "workspace"].includes(subjectType ?? "") ||
      values.length !== 7
    ) this.usage();
    let target: object;
    try {
      target = JSON.parse(targetJson as string) as object;
      if (!target || typeof target !== "object" || Array.isArray(target)) this.usage();
    } catch {
      this.usage();
    }
    return this.confirmations.request({
      id: toId(randomUUID()),
      action: action as string,
      target: target!,
      ...(cwd ? { cwd } : {}),
      risk: risk as string,
      scope: scope as "once" | "run" | "mission",
      ...(subjectType === "run" ? { runId: toId(subjectId as string) } : {}),
      ...(subjectType === "mission" ? { missionId: toId(subjectId as string) } : {}),
      ...(subjectType === "workspace" ? { workspaceId: toId(subjectId as string) } : {}),
      expiresAt: expiresAt as string,
      context: request.context
    });
  }

  private option(values: string[], flag: string): string | undefined {
    const index = values.indexOf(flag);
    if (index < 0) return undefined;
    const value = values[index + 1];
    if (!value) this.usage();
    values.splice(index, 2);
    return value;
  }

  private usage(): never {
    throw new DomainError("Invalid confirmation command", "CLI_USAGE_ERROR");
  }
}
