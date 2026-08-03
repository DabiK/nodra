import type { RunCommand, RunCommandPort } from "@nodra/application";
import type { Id } from "@nodra/domain";
import { and, eq, isNull } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { runCommands } from "./schema/operations.js";

export class SqliteRunCommandStore implements RunCommandPort {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async enqueue(runId: Id, command: RunCommand): Promise<void> {
    const id = `run-command/${runId}/${crypto.randomUUID()}`;
    this.database.orm.insert(runCommands).values({
      id, runId, kind: command.type, payloadJson: JSON.stringify(command), createdAt: new Date().toISOString(), processedAt: null
    }).run();
  }

  pending(runId: string): Array<{ id: string; command: RunCommand }> {
    return this.database.orm.select().from(runCommands).where(eq(runCommands.runId, runId)).all()
      .filter((row) => row.processedAt === null)
      .map((row) => ({ id: row.id, command: JSON.parse(row.payloadJson) as RunCommand }));
  }

  acknowledge(id: string): void {
    this.database.orm.update(runCommands).set({ processedAt: new Date().toISOString() })
      .where(and(eq(runCommands.id, id), isNull(runCommands.processedAt))).run();
  }
}
