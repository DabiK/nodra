import type { ManagerExecutionRepository, PersistManagerStartInput } from "@nodra/application";
import { DomainError, type Id } from "@nodra/domain";
import { and, desc, eq, max } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { conversationItems, conversations } from "./schema/conversations.js";
import { workspaces } from "./schema/core.js";
import { managers } from "./schema/managers.js";
import { businessAuditEvents, outbox } from "./schema/operations.js";
import { runConfigSnapshots, runs } from "./schema/runs.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

export class SqliteManagerExecutionRepository implements ManagerExecutionRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async validateStart(managerId: Id) {
    try {
      const manager = this.database.orm.select().from(managers).where(eq(managers.id, managerId)).get();
      if (!manager?.providerId || !manager.modelId || !manager.workspaceId) {
        throw new DomainError("A manager configuration is required before start", "MANAGER_CONFIG_REQUIRED");
      }
      const workspace = this.database.orm
        .select({ id: workspaces.id, state: workspaces.state, path: workspaces.path })
        .from(workspaces)
        .where(eq(workspaces.id, manager.workspaceId))
        .get();
      if (!workspace) throw new DomainError("The configured workspace was not found", "MANAGER_CONFIG_REQUIRED");
      if (workspace.state !== "ready") {
        throw new DomainError(`The configured workspace is ${workspace.state}, expected ready`, "WORKSPACE_STATE_CONFLICT");
      }
      return {
        providerId: manager.providerId,
        modelId: manager.modelId,
        reasoningEffort: manager.reasoningEffort,
        providerOptionsSchemaVersion: manager.providerOptionsSchemaVersion,
        providerOptionsJson: manager.providerOptionsJson,
        workspaceId: manager.workspaceId,
        workspacePath: workspace.path
      };
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async persistStart(input: PersistManagerStartInput): Promise<void> {
    const manager = input.manager.snapshot();
    try {
      this.database.orm.transaction((transaction) => {
        const updated = transaction
          .update(managers)
          .set({ state: "active", temporalParentWorkflowId: input.workflowId })
          .where(and(eq(managers.id, manager.id), eq(managers.state, "ready")))
          .run();
        const updatedFromBlocked = updated.changes === 1
          ? updated
          : transaction
              .update(managers)
              .set({ state: "active", temporalParentWorkflowId: input.workflowId })
              .where(and(eq(managers.id, manager.id), eq(managers.state, "blocked")))
              .run();
        if (updatedFromBlocked.changes !== 1) {
          throw new DomainError("Manager is not ready to start a run", "MANAGER_STATE_CONFLICT");
        }

        const consumedCommand = transaction
          .select({ id: businessAuditEvents.id })
          .from(businessAuditEvents)
          .where(eq(businessAuditEvents.commandId, input.context.commandId))
          .get();
        if (consumedCommand) {
          throw new DomainError(`Command ${input.context.commandId} was already processed`, "COMMAND_ID_CONFLICT");
        }

        if (!manager.providerId || !manager.modelId || !manager.workspaceId) {
          throw new DomainError("A manager configuration is required before start", "MANAGER_CONFIG_REQUIRED");
        }

        const workspace = transaction
          .select({ path: workspaces.path, state: workspaces.state })
          .from(workspaces)
          .where(eq(workspaces.id, manager.workspaceId))
          .get();
        if (!workspace) throw new DomainError("The configured workspace was not found", "MANAGER_CONFIG_REQUIRED");
        const reserved = transaction
          .update(workspaces)
          .set({ state: "in_use" })
          .where(and(eq(workspaces.id, manager.workspaceId), eq(workspaces.state, "ready")))
          .run();
        if (reserved.changes !== 1) {
          throw new DomainError(`The configured workspace is ${workspace.state}, expected ready`, "WORKSPACE_STATE_CONFLICT");
        }

        let conversationId: string = input.conversationId;
        if (input.reuseConversationId) {
          const existing = transaction
            .select({ id: conversations.id })
            .from(conversations)
            .where(and(eq(conversations.id, input.reuseConversationId), eq(conversations.managerId, manager.id)))
            .get();
          if (!existing) throw new DomainError("Conversation was not found", "CONVERSATION_NOT_FOUND");
          conversationId = existing.id;
        } else {
          transaction.insert(conversations).values({
            id: input.conversationId,
            missionId: null,
            managerId: manager.id,
            providerId: manager.providerId,
            providerSessionRef: null,
            state: "open",
            createdAt: input.context.occurredAt,
            deletedAt: null
          }).run();
        }

        const nextOrdinal = (transaction
          .select({ ordinal: max(conversationItems.ordinal) })
          .from(conversationItems)
          .where(eq(conversationItems.conversationId, conversationId))
          .get()?.ordinal ?? -1) + 1;
        transaction.insert(conversationItems).values({
          id: `conversation-item/${input.runId}/user`,
          conversationId,
          ordinal: nextOrdinal,
          kind: "user",
          deliveryState: "acknowledged",
          body: input.briefPrompt,
          providerItemRef: null,
          createdAt: input.context.occurredAt,
          acknowledgedAt: input.context.occurredAt
        }).run();

        const userAttempt = (transaction
          .select({ userAttempt: runs.userAttempt })
          .from(runs)
          .where(eq(runs.managerId, manager.id))
          .orderBy(desc(runs.userAttempt))
          .limit(1)
          .get()?.userAttempt ?? 0) + 1;

        transaction.insert(runs).values({
          id: input.runId,
          missionId: null,
          managerId: manager.id,
          conversationId,
          userAttempt,
          state: "QUEUED",
          temporalWorkflowId: `run/${input.runId}`,
          temporalRunId: null,
          providerId: manager.providerId,
          modelId: manager.modelId,
          reasoningEffort: manager.reasoningEffort,
          createdAt: input.context.occurredAt
        }).run();

        transaction.insert(runConfigSnapshots).values({
          runId: input.runId,
          resolutionSchemaVersion: 1,
          providerIdRequested: manager.providerId,
          providerIdResolved: manager.providerId,
          modelIdRequested: manager.modelId,
          modelIdResolved: manager.modelId,
          reasoningEffortRequested: manager.reasoningEffort,
          reasoningEffortResolved: manager.reasoningEffort,
          providerOptionsSchemaVersion: manager.providerOptions.schemaVersion,
          providerOptionsJson: JSON.stringify(manager.providerOptions.value),
          providerCapabilitiesJson: JSON.stringify(
            input.providerCatalogSnapshot?.capabilities
              ?? { schemaVersion: 1, status: "not_probed", reason: "provider_out_of_scope" }
          ),
          promptKind: "manager",
          promptCompositionSchemaVersion: 1,
          promptEffective: input.effectivePrompt,
          promptGlobal: null,
          promptManagerInstruction: manager.instruction,
          promptMission: null,
          promptBrief: input.briefPrompt,
          permissionPreset: manager.permissionPreset,
          budgetSnapshotJson: JSON.stringify({ schemaVersion: 1, status: "not_evaluated" }),
          workspaceId: manager.workspaceId,
          cwd: workspace.path,
          gitHead: null,
          gitTree: null,
          createdAt: input.context.occurredAt
        }).run();

        transaction.insert(businessAuditEvents).values([{
          id: input.auditId,
          aggregateKind: "manager",
          aggregateId: manager.id,
          commandId: input.context.commandId,
          eventType: "MANAGER_RUN_REQUESTED",
          actor: input.context.actor,
          payloadJson: JSON.stringify({ schemaVersion: 1, managerId: manager.id, runId: input.runId, workflowId: input.workflowId }),
          occurredAt: input.context.occurredAt
        }, {
          id: `audit/workspace/${input.context.commandId}/in-use`,
          aggregateKind: "workspace",
          aggregateId: manager.workspaceId,
          commandId: input.context.commandId,
          eventType: "WORKSPACE_RESERVED_FOR_RUN",
          actor: input.context.actor,
          payloadJson: JSON.stringify({ schemaVersion: 1, managerId: manager.id, runId: input.runId, previousState: "ready", state: "in_use" }),
          occurredAt: input.context.occurredAt
        }]).run();

        transaction.insert(outbox).values({
          id: input.outboxId,
          kind: "workflow.manager.start",
          aggregateId: manager.id,
          payloadJson: JSON.stringify({
            schemaVersion: 1,
            managerId: manager.id,
            commandId: input.context.commandId,
            runId: input.runId,
            executeProvider: Boolean(input.providerCatalogSnapshot)
          }),
          dedupeKey: input.workflowId,
          createdAt: input.context.occurredAt,
          publishedAt: null
        }).run();
      });
    } catch (error) {
      throw translateSqliteError(error);
    }
  }
}
