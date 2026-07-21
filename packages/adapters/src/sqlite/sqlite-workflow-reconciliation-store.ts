import type { ActiveWorkflowRecord, WorkflowReconciliationStore } from "@nodra/application";
import { asId } from "@nodra/domain";
import { and, eq, inArray } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { missions } from "./schema/missions.js";
import { runs } from "./schema/runs.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

export class SqliteWorkflowReconciliationStore implements WorkflowReconciliationStore {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async listActiveWorkflows(): Promise<ActiveWorkflowRecord[]> {
    try {
      return this.database.orm
        .select({ missionId: missions.id, runId: runs.id, workflowId: missions.temporalParentWorkflowId })
        .from(missions)
        .innerJoin(runs, eq(runs.missionId, missions.id))
        .where(and(
          eq(missions.state, "ACTIVE"),
          inArray(runs.state, ["QUEUED", "STARTING", "RUNNING", "WAITING_APPROVAL"])
        ))
        .all()
        .filter((row): row is typeof row & { workflowId: string } => row.workflowId !== null)
        .map((row) => ({ missionId: asId(row.missionId), runId: asId(row.runId), workflowId: row.workflowId }));
    } catch (error) {
      throw translateSqliteError(error);
    }
  }
}
