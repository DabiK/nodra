import type {
  RunWorkflowStartedInput,
  RunWorkflowStartedResult,
  RunWorkflowTerminalInput,
  RunWorkflowTerminalResult
} from "../temporal/contracts.js";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { workspaces } from "./schema/core.js";
import { businessAuditEvents, inbox, relayItems } from "./schema/operations.js";
import { runConfigSnapshots, runs } from "./schema/runs.js";
import { missions } from "./schema/missions.js";
import { managers } from "./schema/managers.js";
import { conversationItems } from "./schema/conversations.js";
import { translateSqliteError } from "./sqlite-error-translation.js";
import { asId, Mission } from "@nodra/domain";

const consumer = "sqlite.run-workflow-started.v1";
const terminalConsumer = "sqlite.run-workflow-terminal.v1";

export class SqliteRunWorkflowActivity {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async recordStarted(input: RunWorkflowStartedInput): Promise<RunWorkflowStartedResult> {
    if (input.subjectKind === "manager" && input.managerId) {
      return this.recordManagerStarted(input);
    }
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
    if (input.subjectKind === "manager" && input.managerId) {
      return this.recordManagerTerminal(input);
    }
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
          conversationId: runs.conversationId,
          workspaceId: runConfigSnapshots.workspaceId,
          mission: missions
        }).from(runs)
          .innerJoin(runConfigSnapshots, eq(runConfigSnapshots.runId, runs.id))
          .innerJoin(missions, eq(missions.id, runs.missionId))
          .where(and(eq(runs.id, input.runId), eq(runs.missionId, input.missionId)))
          .get();
        if (!run || !run.workspaceId) {
          throw new Error(
            "Terminal Run Workflow Activity could not resolve its persisted run workspace"
          );
        }

        const temporalRunMismatch =
          run.temporalRunId !== null &&
          run.temporalRunId !== input.temporalRunId;

        const missingTemporalRunOutsideQueued =
          run.temporalRunId === null &&
          run.state !== "QUEUED";

        if (temporalRunMismatch || missingTemporalRunOutsideQueued) {
          throw new Error(
            "Terminal Run Workflow Activity detected a Temporal run mismatch"
          );
        }
        if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(run.state)) {
          return { applied: false };
        }


        const updated = transaction.update(runs).set({
          state: input.state,
          temporalRunId: input.temporalRunId,
          endedAt: input.occurredAt
        }).where(and(
          eq(runs.id, input.runId),
          eq(runs.missionId, input.missionId),
          or(
            eq(runs.temporalRunId, input.temporalRunId),
            and(
              isNull(runs.temporalRunId),
              eq(runs.state, "QUEUED")
            )
          ),
          inArray(runs.state, [
            "QUEUED",
            "STARTING",
            "RUNNING",
            "WAITING_APPROVAL",
            "CANCELLING"
          ])
        )).run();


        if (updated.changes !== 1) {
          throw new Error("Terminal Run Workflow Activity lost its run state transition");
        }
        const released = transaction.update(workspaces).set({ state: "ready" })
          .where(and(eq(workspaces.id, run.workspaceId), eq(workspaces.state, "in_use"))).run();
        if (released.changes !== 1) {
          throw new Error("Terminal Run Workflow Activity could not release its workspace");
        }
        const missionState = input.state === "SUCCEEDED" ? "VALIDATION" : "BLOCKED";
        const missionStillActive = run.mission.state === "ACTIVE";
        let missionVersion = run.mission.version + 1;
        if (input.state === "SUCCEEDED" && missionStillActive) {
          const declaredResult = transaction.select({ body: conversationItems.body })
            .from(conversationItems)
            .where(and(
              eq(conversationItems.conversationId, run.conversationId),
              eq(conversationItems.kind, "assistant")
            ))
            .orderBy(desc(conversationItems.ordinal))
            .limit(1)
            .get();
          const mission = Mission.rehydrate({
            id: asId(run.mission.id),
            projectId: run.mission.projectId ? asId(run.mission.projectId) : null,
            title: run.mission.title,
            executionKind: run.mission.executionKind,
            state: run.mission.state,
            version: run.mission.version,
            createdAt: run.mission.createdAt,
            updatedAt: run.mission.updatedAt
          });
          mission.recordAgentSuccess(input.occurredAt, declaredResult?.body ?? "");
          missionVersion = mission.snapshot().version;
        }
        const missionUpdated = transaction.update(missions).set({
          state: missionState,
          version: missionVersion,
          updatedAt: input.occurredAt
        }).where(and(
          eq(missions.id, input.missionId),
          eq(missions.executionKind, "agent"),
          eq(missions.state, "ACTIVE")
        )).run();
        if (missionUpdated.changes !== 1 && missionStillActive) {
          throw new Error("Terminal Run Workflow Activity could not transition its agent mission");
        }
        if (missionUpdated.changes !== 1 && !missionStillActive) {
          // The mission already left ACTIVE (e.g. a session-control turn raced
          // the run terminal with its own auto-validation). The run itself
          // still terminates normally: record the skipped transition instead
          // of failing the whole terminal transaction, which would leave the
          // run stuck in RUNNING forever.
          transaction.insert(businessAuditEvents).values({
            id: `audit/run-terminal-mission-skipped/${input.messageId}`,
            aggregateKind: "run",
            aggregateId: input.runId,
            commandId: input.commandId,
            eventType: "RUN_TERMINAL_MISSION_TRANSITION_SKIPPED",
            actor: "manager",
            payloadJson: JSON.stringify({
              schemaVersion: 1,
              missionId: input.missionId,
              runId: input.runId,
              state: input.state,
              missionState: run.mission.state
            }),
            occurredAt: input.occurredAt
          }).run();
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
          queue: input.state === "SUCCEEDED" ? "decision_required" : "blocked",
          state: "unread",
          reasonCode: input.state === "SUCCEEDED"
            ? "agent_result_requires_validation"
            : `run_${input.state.toLowerCase()}`
        }).where(eq(relayItems.missionId, input.missionId)).run();
        return { applied: true };
      });
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  private async recordManagerStarted(input: RunWorkflowStartedInput): Promise<RunWorkflowStartedResult> {
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
          eq(runs.managerId, input.managerId!),
          inArray(runs.state, ["QUEUED", "STARTING"])
        )).run();
        if (updated.changes !== 1) {
          throw new Error("Run Workflow Activity could not resolve its persisted manager run");
        }
        return { applied: true };
      });
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  private async recordManagerTerminal(input: RunWorkflowTerminalInput): Promise<RunWorkflowTerminalResult> {
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
          .where(and(eq(runs.id, input.runId), eq(runs.managerId, input.managerId!)))
          .get();
        if (!run || !run.workspaceId) {
          throw new Error("Terminal Run Workflow Activity could not resolve its persisted manager run workspace");
        }

        const temporalRunMismatch = run.temporalRunId !== null && run.temporalRunId !== input.temporalRunId;
        const missingTemporalRunOutsideQueued = run.temporalRunId === null && run.state !== "QUEUED";
        if (temporalRunMismatch || missingTemporalRunOutsideQueued) {
          throw new Error("Terminal Run Workflow Activity detected a Temporal run mismatch");
        }
        if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(run.state)) return { applied: false };

        const updated = transaction.update(runs).set({
          state: input.state,
          temporalRunId: input.temporalRunId,
          endedAt: input.occurredAt
        }).where(and(
          eq(runs.id, input.runId),
          eq(runs.managerId, input.managerId!),
          or(
            eq(runs.temporalRunId, input.temporalRunId),
            and(isNull(runs.temporalRunId), eq(runs.state, "QUEUED"))
          ),
          inArray(runs.state, ["QUEUED", "STARTING", "RUNNING", "WAITING_APPROVAL", "CANCELLING"])
        )).run();
        if (updated.changes !== 1) {
          throw new Error("Terminal Run Workflow Activity lost its manager run state transition");
        }
        const released = transaction.update(workspaces).set({ state: "ready" })
          .where(and(eq(workspaces.id, run.workspaceId), eq(workspaces.state, "in_use"))).run();
        if (released.changes !== 1) {
          throw new Error("Terminal Run Workflow Activity could not release its manager workspace");
        }
        const managerState = input.state === "FAILED" ? "blocked" : "ready";
        transaction.update(managers).set({ state: managerState })
          .where(and(eq(managers.id, input.managerId!), eq(managers.state, "active"))).run();
        transaction.insert(businessAuditEvents).values({
          id: `audit/run-terminal/${input.messageId}`,
          aggregateKind: "manager",
          aggregateId: input.managerId!,
          commandId: input.commandId,
          eventType: "MANAGER_RUN_TERMINAL_RECORDED",
          actor: "manager",
          payloadJson: JSON.stringify({ schemaVersion: 1, managerId: input.managerId, runId: input.runId, state: input.state }),
          occurredAt: input.occurredAt
        }).run();
        return { applied: true };
      });
    } catch (error) {
      throw translateSqliteError(error);
    }
  }
}
