import type { RunWorkflowStartedInput, RunWorkflowStartedResult } from "../temporal/contracts.js";
import { and, eq, inArray } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { inbox, relayItems } from "./schema/operations.js";
import { runs } from "./schema/runs.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

const consumer = "sqlite.run-workflow-started.v1";

export class SqliteRunWorkflowActivity {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async recordStarted(input: RunWorkflowStartedInput): Promise<RunWorkflowStartedResult> {
    try {
      return this.database.orm.transaction((transaction) => {
        const inserted = transaction.insert(inbox).values({
          consumer,
          messageId: input.messageId,
          processedAt: input.occurredAt
        }).onConflictDoNothing().run();
        if (inserted.changes === 0) return { applied: false };

        const updated = transaction.update(runs).set({
          state: "STARTING",
          temporalRunId: input.temporalRunId
        }).where(and(
          eq(runs.id, input.runId),
          eq(runs.missionId, input.missionId),
          inArray(runs.state, ["QUEUED", "STARTING"])
        )).run();
        if (updated.changes !== 1) {
          throw new Error("Run Workflow Activity could not resolve its persisted run");
        }
        transaction.update(relayItems).set({ reasonCode: "workflow_started" })
          .where(eq(relayItems.missionId, input.missionId)).run();
        return { applied: true };
      });
    } catch (error) {
      throw translateSqliteError(error);
    }
  }
}
