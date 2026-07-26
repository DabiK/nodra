import type { MissionExecutionRepository, PersistMissionStartInput } from "@nodra/application";
import { DomainError } from "@nodra/domain";
import { and, desc, eq } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { conversations } from "./schema/conversations.js";
import { workspaces } from "./schema/core.js";
import { missionAgentConfigs, missions } from "./schema/missions.js";
import { businessAuditEvents, outbox, relayItems } from "./schema/operations.js";
import { runConfigSnapshots, runs } from "./schema/runs.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

export class SqliteMissionExecutionRepository implements MissionExecutionRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async validateStart(missionId: Parameters<MissionExecutionRepository["validateStart"]>[0]): Promise<void> {
    try {
      const config = this.database.orm
        .select()
        .from(missionAgentConfigs)
        .where(eq(missionAgentConfigs.missionId, missionId))
        .get();
      if (!config?.providerId || !config.modelId || !config.permissionPreset || !config.workspaceId) {
        throw new DomainError("A persisted agent configuration is required before start", "AGENT_CONFIG_REQUIRED");
      }
      const workspace = this.database.orm
        .select({ id: workspaces.id, state: workspaces.state })
        .from(workspaces)
        .where(eq(workspaces.id, config.workspaceId))
        .get();
      if (!workspace) throw new DomainError("The configured workspace was not found", "AGENT_CONFIG_REQUIRED");
      if (workspace.state !== "ready") {
        throw new DomainError(
          `The configured workspace is ${workspace.state}, expected ready`,
          "WORKSPACE_STATE_CONFLICT"
        );
      }
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async persistStart(input: PersistMissionStartInput): Promise<void> {
    const mission = input.mission.snapshot();
    try {
      this.database.orm.transaction((transaction) => {
        const updated = transaction
          .update(missions)
          .set({
            state: mission.state,
            version: mission.version,
            temporalParentWorkflowId: input.workflowId,
            updatedAt: mission.updatedAt
          })
          .where(and(eq(missions.id, mission.id), eq(missions.version, input.expectedVersion)))
          .run();
        if (updated.changes !== 1) throw new DomainError("Mission version conflict", "MISSION_VERSION_CONFLICT");

        const consumedCommand = transaction
          .select({ id: businessAuditEvents.id })
          .from(businessAuditEvents)
          .where(eq(businessAuditEvents.commandId, input.context.commandId))
          .get();
        if (consumedCommand) {
          throw new DomainError(`Command ${input.context.commandId} was already processed`, "COMMAND_ID_CONFLICT");
        }

        const config = transaction
          .select()
          .from(missionAgentConfigs)
          .where(eq(missionAgentConfigs.missionId, mission.id))
          .get();
        if (!config?.providerId || !config.modelId || !config.permissionPreset || !config.workspaceId) {
          throw new DomainError("A persisted agent configuration is required before start", "AGENT_CONFIG_REQUIRED");
        }
        const workspace = transaction
          .select({ path: workspaces.path, state: workspaces.state })
          .from(workspaces)
          .where(eq(workspaces.id, config.workspaceId))
          .get();
        if (!workspace) throw new DomainError("The configured workspace was not found", "AGENT_CONFIG_REQUIRED");
        const reservedWorkspace = transaction
          .update(workspaces)
          .set({ state: "in_use" })
          .where(and(eq(workspaces.id, config.workspaceId), eq(workspaces.state, "ready")))
          .run();
        if (reservedWorkspace.changes !== 1) {
          throw new DomainError(
            `The configured workspace is ${workspace.state}, expected ready`,
            "WORKSPACE_STATE_CONFLICT"
          );
        }

        const previousRun = transaction
          .select({ userAttempt: runs.userAttempt })
          .from(runs)
          .where(eq(runs.missionId, mission.id))
          .orderBy(desc(runs.userAttempt))
          .limit(1)
          .get();
        const userAttempt = (previousRun?.userAttempt ?? 0) + 1;

        transaction.insert(conversations).values({
          id: input.conversationId,
          missionId: mission.id,
          managerId: null,
          providerId: config.providerId,
          providerSessionRef: null,
          state: "open",
          createdAt: input.context.occurredAt,
          deletedAt: null
        }).run();
        transaction.insert(runs).values({
          id: input.runId,
          missionId: mission.id,
          managerId: null,
          conversationId: input.conversationId,
          userAttempt,
          state: "QUEUED",
          temporalWorkflowId: `run/${input.runId}`,
          temporalRunId: null,
          providerId: config.providerId,
          modelId: config.modelId,
          reasoningEffort: config.reasoningEffort,
          createdAt: input.context.occurredAt
        }).run();
        transaction.insert(runConfigSnapshots).values({
          runId: input.runId,
          resolutionSchemaVersion: 1,
          providerIdRequested: config.providerId,
          providerIdResolved: config.providerId,
          modelIdRequested: config.modelId,
          modelIdResolved: config.modelId,
          reasoningEffortRequested: config.reasoningEffort,
          reasoningEffortResolved: config.reasoningEffort,
          providerOptionsSchemaVersion: config.providerOptionsSchemaVersion,
          providerOptionsJson: config.providerOptionsJson,
          providerCapabilitiesJson: JSON.stringify({ schemaVersion: 1, status: "not_probed", reason: "provider_out_of_scope_i3" }),
          promptKind: "mission",
          promptCompositionSchemaVersion: 1,
          promptEffective: config.missionPrompt,
          promptGlobal: null,
          promptManagerInstruction: null,
          promptMission: config.missionPrompt,
          promptBrief: null,
          permissionPreset: config.permissionPreset,
          budgetSnapshotJson: JSON.stringify({ schemaVersion: 1, status: "not_evaluated", reason: "budget_out_of_scope_i3" }),
          workspaceId: config.workspaceId,
          cwd: workspace.path,
          gitHead: null,
          gitTree: null,
          createdAt: input.context.occurredAt
        }).run();

        transaction.insert(businessAuditEvents).values({
          id: input.auditId,
          aggregateKind: "mission",
          aggregateId: mission.id,
          commandId: input.context.commandId,
          eventType: "MISSION_START_REQUESTED",
          actor: input.context.actor,
          payloadJson: JSON.stringify({
            schemaVersion: 1,
            missionId: mission.id,
            runId: input.runId,
            workflowId: input.workflowId,
            missionVersion: mission.version
          }),
          occurredAt: input.context.occurredAt
        }).run();
        transaction.insert(businessAuditEvents).values({
          id: `audit/workspace/${input.context.commandId}/in-use`,
          aggregateKind: "workspace",
          aggregateId: config.workspaceId,
          commandId: input.context.commandId,
          eventType: "WORKSPACE_RESERVED_FOR_RUN",
          actor: input.context.actor,
          payloadJson: JSON.stringify({
            schemaVersion: 1,
            missionId: mission.id,
            runId: input.runId,
            previousState: "ready",
            state: "in_use"
          }),
          occurredAt: input.context.occurredAt
        }).run();
        transaction.insert(outbox).values({
          id: input.outboxId,
          kind: "workflow.mission.start",
          aggregateId: mission.id,
          payloadJson: JSON.stringify({
            schemaVersion: 1,
            missionId: mission.id,
            commandId: input.context.commandId,
            runId: input.runId
          }),
          dedupeKey: input.workflowId,
          createdAt: input.context.occurredAt,
          publishedAt: null
        }).run();
        transaction.insert(relayItems).values({
          id: `relay/mission/${mission.id}`,
          missionId: mission.id,
          pipelineRunId: null,
          queue: "active",
          state: "unread",
          reasonCode: "workflow_dispatch_pending",
          createdAt: input.context.occurredAt
        }).onConflictDoUpdate({
          target: relayItems.id,
          set: {
            queue: "active",
            state: "unread",
            reasonCode: "workflow_dispatch_pending",
            createdAt: input.context.occurredAt,
            readAt: null,
            snoozedUntil: null,
            resolvedAt: null
          }
        }).run();
      });
    } catch (error) {
      throw translateSqliteError(error);
    }
  }
}
