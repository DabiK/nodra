import type {
  AdvancePipelineInput,
  CreatePipelineInput,
  PipelineAdvanceResult,
  PipelineRepository,
  PipelineRunView,
  PipelineView,
  StartPipelineInput
} from "@nodra/application";
import { asId, DomainError, type Id } from "@nodra/domain";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { missions } from "./schema/missions.js";
import { businessAuditEvents, relayItems } from "./schema/operations.js";
import {
  pipelineDefinitions,
  pipelineEdges,
  pipelineNodeRuns,
  pipelineNodes,
  pipelineRuns,
  pipelines
} from "./schema/pipelines.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

export class SqlitePipelineRepository implements PipelineRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async create(input: CreatePipelineInput): Promise<PipelineView> {
    try {
      this.database.orm.transaction((transaction) => {
        const missionRows = transaction.select({ id: missions.id })
          .from(missions)
          .where(inArray(missions.id, input.nodes.map((node) => node.missionId)))
          .all();
        if (missionRows.length !== new Set(input.nodes.map((node) => node.missionId)).size) {
          throw new DomainError("Pipeline references an unknown mission", "PIPELINE_MISSION_NOT_FOUND");
        }
        transaction.insert(pipelines).values({
          id: input.pipelineId,
          projectId: input.projectId ?? null,
          name: input.name.trim(),
          state: "draft",
          createdAt: input.context.occurredAt,
          completedAt: null,
          archivedAt: null
        }).run();
        transaction.insert(pipelineDefinitions).values({
          id: input.definitionId,
          pipelineId: input.pipelineId,
          version: 1,
          definitionState: "published",
          createdAt: input.context.occurredAt
        }).run();
        const nodeRows = input.nodes.map((node, index) => ({
          id: `${input.nodeIdPrefix}/${index}`,
          definitionId: input.definitionId,
          missionId: node.missionId,
          nodeKey: node.nodeKey,
          startMode: "auto" as const
        }));
        transaction.insert(pipelineNodes).values(nodeRows).run();
        const nodeByKey = new Map(nodeRows.map((node) => [node.nodeKey, node]));
        const edgeInputs = input.edges ?? input.nodes.slice(0, -1).map((node, index) => ({
          fromNodeKey: node.nodeKey,
          toNodeKey: input.nodes[index + 1]!.nodeKey
        }));
        if (edgeInputs.length > 0) {
          transaction.insert(pipelineEdges).values(edgeInputs.map((edge, index) => ({
            id: `${input.edgeIdPrefix}/${index}`,
            definitionId: input.definitionId,
            fromNodeId: nodeByKey.get(edge.fromNodeKey)!.id,
            toNodeId: nodeByKey.get(edge.toNodeKey)!.id
          }))).run();
        }
        transaction.insert(businessAuditEvents).values({
          id: `audit/pipeline-created/${input.context.commandId}`,
          aggregateKind: "pipeline",
          aggregateId: input.pipelineId,
          commandId: input.context.commandId,
          eventType: "PIPELINE_CREATED",
          actor: input.context.actor,
          payloadJson: JSON.stringify({ schemaVersion: 1, nodeCount: input.nodes.length }),
          occurredAt: input.context.occurredAt
        }).run();
      });
      const created = await this.show(input.pipelineId);
      if (!created) throw new DomainError("Pipeline was not persisted", "PERSISTENCE_FAILURE");
      return created;
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async show(id: Id): Promise<PipelineView | null> {
    try {
      return this.readPipeline(id);
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async showRun(id: Id): Promise<PipelineRunView | null> {
    try {
      return this.readRun(id);
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async start(input: StartPipelineInput): Promise<PipelineAdvanceResult> {
    try {
      this.database.orm.transaction((transaction) => {
        const definition = transaction.select()
          .from(pipelineDefinitions)
          .where(and(
            eq(pipelineDefinitions.pipelineId, input.pipelineId),
            eq(pipelineDefinitions.definitionState, "published")
          ))
          .orderBy(asc(pipelineDefinitions.version))
          .get();
        if (!definition) throw new DomainError("Pipeline has no published definition", "PIPELINE_DEFINITION_NOT_FOUND");
        const nodes = transaction.select().from(pipelineNodes)
          .where(eq(pipelineNodes.definitionId, definition.id))
          .orderBy(asc(pipelineNodes.nodeKey), asc(pipelineNodes.id))
          .all();
        if (nodes.length === 0) throw new DomainError("Pipeline has no nodes", "PIPELINE_EMPTY");
        transaction.update(pipelines).set({ state: "active" })
          .where(eq(pipelines.id, input.pipelineId)).run();
        transaction.insert(pipelineRuns).values({
          id: input.pipelineRunId,
          pipelineId: input.pipelineId,
          definitionId: definition.id,
          state: "active",
          temporalWorkflowId: null,
          startedAt: input.context.occurredAt,
          endedAt: null,
          createdAt: input.context.occurredAt
        }).run();
        const edges = transaction.select().from(pipelineEdges)
          .where(eq(pipelineEdges.definitionId, definition.id)).all();
        const nodesWithIncoming = new Set(edges.map((edge) => edge.toNodeId));
        transaction.insert(pipelineNodeRuns).values(nodes.map((node, index) => ({
          id: `${input.nodeRunIdPrefix}/${index}`,
          pipelineRunId: input.pipelineRunId,
          nodeId: node.id,
          ...(node.missionId ? { missionId: node.missionId } : {}),
          state: nodesWithIncoming.has(node.id) ? "pending" as const : "ready" as const,
          userAttempt: 1
        }))).run();
        transaction.insert(relayItems).values({
          id: `relay/pipeline/${input.pipelineRunId}`,
          missionId: null,
          pipelineRunId: input.pipelineRunId,
          queue: "active",
          state: "unread",
          reasonCode: "pipeline_started",
          createdAt: input.context.occurredAt
        }).run();
        transaction.insert(businessAuditEvents).values({
          id: `audit/pipeline-started/${input.context.commandId}`,
          aggregateKind: "pipeline_run",
          aggregateId: input.pipelineRunId,
          commandId: input.context.commandId,
          eventType: "PIPELINE_STARTED",
          actor: input.context.actor,
          payloadJson: JSON.stringify({ schemaVersion: 1, pipelineId: input.pipelineId }),
          occurredAt: input.context.occurredAt
        }).run();
      });
      const pipelineRun = await this.showRun(input.pipelineRunId);
      if (!pipelineRun) throw new DomainError("Pipeline run was not persisted", "PERSISTENCE_FAILURE");
      return { pipelineRun, startedMissionIds: [] };
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async advance(input: AdvancePipelineInput): Promise<PipelineAdvanceResult> {
    const startedMissionIds: Id[] = [];
    await this.reconcile(input.pipelineRunId, input.context.occurredAt);
    const run = await this.showRun(input.pipelineRunId);
    if (!run) throw new DomainError("Pipeline run was not found", "PIPELINE_RUN_NOT_FOUND");
    for (const node of run.nodes.filter((candidate) => candidate.state === "ready")) {
      if (node.missionKind === "agent" && node.missionState === "READY") {
        await input.startMission(node.missionId);
        startedMissionIds.push(node.missionId);
        this.database.orm.update(pipelineNodeRuns).set({ state: "active" })
          .where(eq(pipelineNodeRuns.id, node.id)).run();
      }
    }
    await this.reconcile(input.pipelineRunId, input.context.occurredAt);
    const updated = await this.showRun(input.pipelineRunId);
    if (!updated) throw new DomainError("Pipeline run disappeared", "PERSISTENCE_FAILURE");
    return { pipelineRun: updated, startedMissionIds };
  }

  private async reconcile(pipelineRunId: Id, now: string): Promise<void> {
    this.database.orm.transaction((transaction) => {
      const rows = this.nodeRows(pipelineRunId);
      for (const row of rows) {
        if (["ready", "active"].includes(row.nodeRun.state) && row.mission.state === "DONE") {
          transaction.update(pipelineNodeRuns).set({ state: "completed" })
            .where(eq(pipelineNodeRuns.id, row.nodeRun.id)).run();
        }
        if (row.nodeRun.state === "active" && ["BLOCKED", "ABANDONED"].includes(row.mission.state)) {
          transaction.update(pipelineNodeRuns).set({ state: "failed" })
            .where(eq(pipelineNodeRuns.id, row.nodeRun.id)).run();
        }
        if (row.nodeRun.state === "active" && row.mission.state === "VALIDATION") {
          transaction.update(pipelineRuns).set({ state: "blocked" })
            .where(eq(pipelineRuns.id, pipelineRunId)).run();
          transaction.update(relayItems).set({ queue: "decision_required", reasonCode: "pipeline_waiting_human_validation" })
            .where(eq(relayItems.pipelineRunId, pipelineRunId)).run();
          return;
        }
      }
      const fresh = this.nodeRows(pipelineRunId);
      for (const row of fresh.filter((candidate) => candidate.nodeRun.state === "pending")) {
        const incoming = transaction.select().from(pipelineEdges)
          .where(eq(pipelineEdges.toNodeId, row.node.id)).all();
        const predecessorsDone = incoming.every((edge) =>
          fresh.some((candidate) => candidate.node.id === edge.fromNodeId && candidate.nodeRun.state === "completed")
        );
        if (predecessorsDone) {
          transaction.update(pipelineNodeRuns).set({ state: "ready" })
            .where(eq(pipelineNodeRuns.id, row.nodeRun.id)).run();
        }
      }
      const finalRows = this.nodeRows(pipelineRunId);
      if (finalRows.every((row) => row.nodeRun.state === "completed")) {
        transaction.update(pipelineRuns).set({ state: "completed", endedAt: now })
          .where(eq(pipelineRuns.id, pipelineRunId)).run();
        transaction.update(relayItems).set({ queue: "decision_required", state: "resolved", reasonCode: "pipeline_completed", resolvedAt: now })
          .where(eq(relayItems.pipelineRunId, pipelineRunId)).run();
      } else if (finalRows.some((row) => row.nodeRun.state === "failed")) {
        transaction.update(pipelineRuns).set({ state: "failed", endedAt: now })
          .where(eq(pipelineRuns.id, pipelineRunId)).run();
        transaction.update(relayItems).set({ queue: "blocked", reasonCode: "pipeline_node_failed" })
          .where(eq(relayItems.pipelineRunId, pipelineRunId)).run();
      } else {
        transaction.update(pipelineRuns).set({ state: "active" })
          .where(eq(pipelineRuns.id, pipelineRunId)).run();
        transaction.update(relayItems).set({ queue: "active", reasonCode: "pipeline_active" })
          .where(eq(relayItems.pipelineRunId, pipelineRunId)).run();
      }
    });
  }

  private readPipeline(id: Id): PipelineView | null {
    const pipeline = this.database.orm.select().from(pipelines).where(eq(pipelines.id, id)).get();
    if (!pipeline) return null;
    const definition = this.database.orm.select().from(pipelineDefinitions)
      .where(eq(pipelineDefinitions.pipelineId, id))
      .orderBy(asc(pipelineDefinitions.version))
      .get();
    if (!definition) throw new DomainError("Pipeline has no definition", "PIPELINE_DEFINITION_NOT_FOUND");
    const nodes = this.database.orm.select().from(pipelineNodes)
      .where(eq(pipelineNodes.definitionId, definition.id))
      .orderBy(asc(pipelineNodes.nodeKey), asc(pipelineNodes.id))
      .all();
    const edges = this.database.orm.select().from(pipelineEdges)
      .where(eq(pipelineEdges.definitionId, definition.id))
      .orderBy(asc(pipelineEdges.id))
      .all();
    return {
      id: asId(pipeline.id),
      projectId: pipeline.projectId ? asId(pipeline.projectId) : null,
      name: pipeline.name,
      state: pipeline.state,
      definition: {
        id: asId(definition.id),
        version: definition.version,
        state: definition.definitionState,
        nodes: nodes.map((node) => ({
          id: asId(node.id),
          nodeKey: node.nodeKey,
          missionId: asId(node.missionId!),
          startMode: node.startMode
        })),
        edges: edges.map((edge) => ({
          id: asId(edge.id),
          fromNodeId: asId(edge.fromNodeId),
          toNodeId: asId(edge.toNodeId)
        }))
      }
    };
  }

  private readRun(id: Id): PipelineRunView | null {
    const run = this.database.orm.select().from(pipelineRuns).where(eq(pipelineRuns.id, id)).get();
    if (!run) return null;
    const nodes = this.nodeRows(id);
    return {
      id: asId(run.id),
      pipelineId: asId(run.pipelineId),
      definitionId: asId(run.definitionId),
      state: run.state,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      createdAt: run.createdAt,
      nodes: nodes.map((row) => ({
        id: asId(row.nodeRun.id),
        nodeId: asId(row.node.id),
        nodeKey: row.node.nodeKey,
        missionId: asId(row.mission.id),
        missionKind: row.mission.executionKind,
        missionState: row.mission.state,
        state: row.nodeRun.state,
        userAttempt: row.nodeRun.userAttempt
      }))
    };
  }

  private nodeRows(pipelineRunId: Id) {
    return this.database.orm.select({ nodeRun: pipelineNodeRuns, node: pipelineNodes, mission: missions })
      .from(pipelineNodeRuns)
      .innerJoin(pipelineNodes, eq(pipelineNodes.id, pipelineNodeRuns.nodeId))
      .innerJoin(missions, eq(missions.id, pipelineNodeRuns.missionId))
      .where(eq(pipelineNodeRuns.pipelineRunId, pipelineRunId))
      .orderBy(asc(pipelineNodes.nodeKey), asc(pipelineNodes.id))
      .all();
  }
}
