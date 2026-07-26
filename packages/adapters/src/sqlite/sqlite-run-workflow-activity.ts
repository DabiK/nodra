import type {
  RunWorkflowStartedInput,
  RunWorkflowStartedResult,
  RunWorkflowTerminalInput,
  RunWorkflowTerminalResult
} from "../temporal/contracts.js";
import { and, eq, inArray } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { workspaces } from "./schema/core.js";
import { businessAuditEvents, inbox, relayItems } from "./schema/operations.js";
import { runConfigSnapshots, runs } from "./schema/runs.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

const consumer = "sqlite.run-workflow-started.v1";
const terminalConsumer = "sqlite.run-workflow-terminal.v1";

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

  async recordTerminal(input: RunWorkflowTerminalInput): Promise<RunWorkflowTerminalResult> {
    try {
      return this.database.orm.transaction((transaction) => {
        const inserted = transaction.insert(inbox).values({
          consumer: terminalConsumer,
          messageId: input.messageId,
          processedAt: input.occurredAt
        }).onConflictDoNothing().run();
        if (inserted.changes === 0) return { applied: false };

        const run = transaction.select({
          state: runs.state,
          temporalRunId: runs.temporalRunId,
          workspaceId: runConfigSnapshots.workspaceId
        }).from(runs)
          .innerJoin(runConfigSnapshots, eq(runConfigSnapshots.runId, runs.id))
          .where(and(eq(runs.id, input.runId), eq(runs.missionId, input.missionId)))
          .get();
        if (!run || run.temporalRunId !== input.temporalRunId || !run.workspaceId) {
          throw new Error("Terminal Run Workflow Activity could not resolve its persisted run workspace");
        }
        if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(run.state)) {
          return { applied: false };
        }
        const updated = transaction.update(runs).set({
          state: input.state,
          endedAt: input.occurredAt
        }).where(and(
          eq(runs.id, input.runId),
          eq(runs.missionId, input.missionId),
          eq(runs.temporalRunId, input.temporalRunId),
          inArray(runs.state, ["QUEUED", "STARTING", "RUNNING", "WAITING_APPROVAL", "CANCELLING"])
        )).run();
        if (updated.changes !== 1) {
          throw new Error("Terminal Run Workflow Activity lost its run state transition");
        }
        const released = transaction.update(workspaces).set({ state: "ready" })
          .where(and(eq(workspaces.id, run.workspaceId), eq(workspaces.state, "in_use"))).run();
        if (released.changes !== 1) {
          throw new Error("Terminal Run Workflow Activity could not release its workspace");
        }
        transaction.insert(businessAuditEvents).values([{
          id: `audit/run-terminal/${input.messageId}`,
          aggregateKind: "run",
          aggregateId: input.runId,
          commandId: input.commandId,
          eventType: "RUN_TERMINAL_RECORDED",
          actor: "manager",
          payloadJson: JSON.stringify({
            schemaVersion: 1,
            missionId: input.missionId,
            state: input.state
          }),
          occurredAt: input.occurredAt
        }, {
          id: `audit/workspace-release/${input.messageId}`,
          aggregateKind: "workspace",
          aggregateId: run.workspaceId,
          commandId: input.commandId,
          eventType: "WORKSPACE_RELEASED_FROM_RUN",
          actor: "manager",
          payloadJson: JSON.stringify({
            schemaVersion: 1,
            missionId: input.missionId,
            runId: input.runId,
            previousState: "in_use",
            state: "ready",
            runState: input.state
          }),
          occurredAt: input.occurredAt
        }]).run();
        transaction.update(relayItems).set({
          reasonCode: `run_${input.state.toLowerCase()}`
        }).where(eq(relayItems.missionId, input.missionId)).run();
        return { applied: true };
      });
    } catch (error) {
      throw translateSqliteError(error);
    }
  }
}
