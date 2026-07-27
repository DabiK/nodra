import { asc, eq } from "drizzle-orm";
import type { NodraSqliteDatabase } from "@nodra/adapters";
import { conversationItems, runs } from "@nodra/adapters";
import { DomainError, toId } from "@nodra/application";
import type { I4CliHandler, I4CliRequest } from "./i4-cli.js";

export class ConversationCli implements I4CliHandler {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async execute(request: I4CliRequest): Promise<unknown | undefined> {
    if (request.command !== "mission:messages") return undefined;
    const values = [...request.args];
    const role = this.option(values, "--role") ?? "assistant";
    const lastOnly = this.flag(values, "--last");
    const [missionId] = values;
    if (!missionId || values.length !== 1) {
      throw new DomainError(
        "Usage: mission:messages <missionId> [--role assistant|user|tool|all] [--last]",
        "CLI_USAGE_ERROR"
      );
    }

    const missionRuns = this.database.orm
      .select({ id: runs.id, conversationId: runs.conversationId, createdAt: runs.createdAt })
      .from(runs)
      .where(eq(runs.missionId, toId(missionId)))
      .orderBy(asc(runs.createdAt))
      .all();

    const messages = missionRuns.flatMap((run) =>
      this.database.orm
        .select({ ordinal: conversationItems.ordinal, kind: conversationItems.kind, body: conversationItems.body, createdAt: conversationItems.createdAt })
        .from(conversationItems)
        .where(eq(conversationItems.conversationId, run.conversationId))
        .orderBy(asc(conversationItems.ordinal))
        .all()
        .filter((item) => (role === "all" ? true : item.kind === role) && item.body?.trim())
        .map((item) => ({ runId: run.id, ordinal: item.ordinal, kind: item.kind, body: item.body, createdAt: item.createdAt }))
    );

    const selected = lastOnly ? messages.slice(-1) : messages;
    return { missionId, role, count: selected.length, messages: selected };
  }

  private option(values: string[], flag: string): string | undefined {
    const index = values.indexOf(flag);
    if (index < 0) return undefined;
    const value = values[index + 1];
    if (!value) throw new DomainError(`${flag} requires a value`, "CLI_USAGE_ERROR");
    values.splice(index, 2);
    return value;
  }

  private flag(values: string[], flag: string): boolean {
    const index = values.indexOf(flag);
    if (index < 0) return false;
    values.splice(index, 1);
    return true;
  }
}
