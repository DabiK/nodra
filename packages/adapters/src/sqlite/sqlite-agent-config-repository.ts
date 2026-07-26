import type {
  AgentConfig,
  AgentConfigRepository,
  EnableAgentConfigInput,
  UpdateAgentConfigInput
} from "@nodra/application";
import { asId, DomainError } from "@nodra/domain";
import { and, eq } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { mcpSelections } from "./schema/access-control.js";
import { workspaces } from "./schema/core.js";
import { missionAgentConfigs, missionInputAttachments, missions } from "./schema/missions.js";
import { businessAuditEvents } from "./schema/operations.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

export class SqliteAgentConfigRepository implements AgentConfigRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async enable(input: EnableAgentConfigInput): Promise<AgentConfig> {
    const mission = input.mission.snapshot();
    try {
      this.database.orm.transaction((tx) => {
        const updated = tx.update(missions).set({
          executionKind: mission.executionKind,
          version: mission.version,
          updatedAt: mission.updatedAt
        }).where(and(
          eq(missions.id, mission.id),
          eq(missions.executionKind, "human"),
          eq(missions.state, "DRAFT"),
          eq(missions.version, input.expectedMissionVersion)
        )).run();
        if (updated.changes !== 1) {
          throw new DomainError("Mission version conflict", "MISSION_VERSION_CONFLICT");
        }
        tx.insert(missionAgentConfigs).values({
          missionId: mission.id,
          version: 0,
          providerOptionsSchemaVersion: 1,
          providerOptionsJson: "{}",
          missionPrompt: "",
          autoCommitAuthorized: 0,
          updatedAt: input.context.occurredAt
        }).run();
        tx.insert(businessAuditEvents).values({
          id: `audit/${input.context.commandId}`,
          aggregateKind: "mission",
          aggregateId: mission.id,
          commandId: input.context.commandId,
          eventType: "MISSION_AGENT_ENABLED",
          actor: input.context.actor,
          payloadJson: JSON.stringify({
            schemaVersion: 1,
            missionVersion: mission.version,
            agentConfigVersion: 0
          }),
          occurredAt: input.context.occurredAt
        }).run();
      });
      return (await this.get(mission.id))!;
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async get(missionId: Parameters<AgentConfigRepository["get"]>[0]): Promise<AgentConfig | null> {
    try {
      const row = this.database.orm.select().from(missionAgentConfigs)
        .where(eq(missionAgentConfigs.missionId, missionId)).get();
      return row ? this.toConfig(row) : null;
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async update(input: UpdateAgentConfigInput): Promise<AgentConfig> {
    try {
      this.database.orm.transaction((tx) => {
        const mission = tx.select({
          executionKind: missions.executionKind,
          state: missions.state
        }).from(missions).where(eq(missions.id, input.missionId)).get();
        if (!mission) throw new DomainError(`Mission ${input.missionId} was not found`, "MISSION_NOT_FOUND");
        if (mission.executionKind !== "agent") {
          throw new DomainError("A human mission has no agent configuration", "AGENT_CONFIG_REQUIRED");
        }
        if (mission.state !== "DRAFT") {
          throw new DomainError("Agent configuration is locked outside DRAFT", "AGENT_CONFIG_LOCKED");
        }
        const changed = tx.update(missionAgentConfigs).set({
          version: input.expectedVersion + 1,
          providerId: input.values.providerId,
          modelId: input.values.modelId,
          reasoningEffort: input.values.reasoningEffort,
          providerOptionsSchemaVersion: input.values.providerOptions.schemaVersion,
          providerOptionsJson: JSON.stringify(input.values.providerOptions.value),
          missionPrompt: input.values.missionPrompt.trim(),
          permissionPreset: input.values.permissionPreset,
          workspaceId: input.values.workspaceId,
          autoCommitAuthorized: input.values.autoCommitAuthorized ? 1 : 0,
          integrationTargetRef: input.values.integrationTargetRef,
          updatedAt: input.context.occurredAt
        }).where(and(
          eq(missionAgentConfigs.missionId, input.missionId),
          eq(missionAgentConfigs.version, input.expectedVersion)
        )).run();
        if (changed.changes !== 1) {
          throw new DomainError("Agent configuration version conflict", "MISSION_VERSION_CONFLICT");
        }
        tx.insert(businessAuditEvents).values({
          id: `audit/${input.context.commandId}`,
          aggregateKind: "mission",
          aggregateId: input.missionId,
          commandId: input.context.commandId,
          eventType: "MISSION_AGENT_CONFIG_UPDATED",
          actor: input.context.actor,
          payloadJson: JSON.stringify({
            schemaVersion: 1,
            previousVersion: input.expectedVersion,
            version: input.expectedVersion + 1
          }),
          occurredAt: input.context.occurredAt
        }).run();
      });
      return (await this.get(input.missionId))!;
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async resolutionSource(missionId: Parameters<AgentConfigRepository["resolutionSource"]>[0]) {
    try {
      const mission = this.database.orm.select().from(missions).where(eq(missions.id, missionId)).get();
      const config = await this.get(missionId);
      if (!mission || !config || mission.executionKind !== "agent") return null;
      const workspace = config.workspaceId
        ? this.database.orm.select({
            id: workspaces.id,
            path: workspaces.path,
            state: workspaces.state
          }).from(workspaces).where(eq(workspaces.id, config.workspaceId)).get()
        : null;
      const attachment = this.database.orm.select({ ordinal: missionInputAttachments.ordinal })
        .from(missionInputAttachments).where(eq(missionInputAttachments.missionId, missionId)).limit(1).get();
      const mcp = this.database.orm.select({ mode: mcpSelections.selectionMode })
        .from(mcpSelections)
        .where(and(eq(mcpSelections.ownerKind, "mission"), eq(mcpSelections.ownerId, missionId))).get();
      return {
        mission: {
          id: asId(mission.id),
          projectId: mission.projectId ? asId(mission.projectId) : null,
          title: mission.title,
          executionKind: mission.executionKind,
          state: mission.state,
          version: mission.version,
          createdAt: mission.createdAt,
          updatedAt: mission.updatedAt
        },
        config,
        workspace: workspace ? { ...workspace, id: asId(workspace.id) } : null,
        attachmentsRequested: Boolean(attachment),
        mcpRequested: Boolean(mcp && mcp.mode !== "none")
      };
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  private toConfig(row: typeof missionAgentConfigs.$inferSelect): AgentConfig {
    const value: unknown = JSON.parse(row.providerOptionsJson);
    return {
      missionId: asId(row.missionId),
      version: row.version,
      providerId: row.providerId,
      modelId: row.modelId,
      reasoningEffort: row.reasoningEffort as AgentConfig["reasoningEffort"],
      providerOptions: {
        schemaVersion: row.providerOptionsSchemaVersion,
        value: value as Record<string, unknown>
      },
      missionPrompt: row.missionPrompt,
      permissionPreset: row.permissionPreset,
      workspaceId: row.workspaceId ? asId(row.workspaceId) : null,
      autoCommitAuthorized: row.autoCommitAuthorized === 1,
      integrationTargetRef: row.integrationTargetRef,
      updatedAt: row.updatedAt
    };
  }
}
