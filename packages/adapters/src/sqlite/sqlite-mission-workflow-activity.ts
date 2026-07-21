import type { MissionWorkflowStartedInput, MissionWorkflowStartedResult } from "../temporal/contracts.js";
import { and, eq, inArray } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { inbox, relayItems } from "./schema/operations.js";
import { runs } from "./schema/runs.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

const consumer = "sqlite.mission-workflow-started.v1";

export class SqliteMissionWorkflowActivity {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async recordStarted(input: MissionWorkflowStartedInput): Promise<MissionWorkflowStartedResult> {
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
          eq(runs.missionId, input.missionId),
          inArray(runs.state, ["QUEUED", "STARTING"])
        )).run();
        if (updated.changes !== 1) {
          throw new Error("Mission workflow Activity could not resolve its persisted run");
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
