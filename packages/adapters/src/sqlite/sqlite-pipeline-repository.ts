import type {
  AdvancePipelineInput,
  CreatePipelineInput,
  PipelineAdvanceResult,
  PipelineListItemView,
  PipelineRepository,
  PipelineRunView,
  PipelineView,
  PublishPipelineNodeHandoverInput,
  SetPipelineNodeTransitionModeInput,
  ApprovePipelineNodeTransitionInput,
  StartPipelineInput
} from "@nodra/application";
import { asId, DomainError, type Id } from "@nodra/domain";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { missions } from "./schema/missions.js";
import { conversationItems } from "./schema/conversations.js";
import { runs } from "./schema/runs.js";
import { businessAuditEvents, relayItems } from "./schema/operations.js";
import {
  pipelineDefinitions,
  pipelineEdges,
  pipelineNodeRuns,
  pipelineNodes,
  pipelineRuns,
  pipelines,
  handovers
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
          startMode: node.transitionMode ?? "auto" as const
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

  async list(): Promise<PipelineListItemView[]> {
    try {
      const rows = this.database.orm.select().from(pipelines).orderBy(desc(pipelines.createdAt)).all();
      return rows.map((pipeline) => this.readListItem(pipeline));
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
        await input.startMission(node.missionId, this.handoverPrompt(node.handovers));
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

  async setNodeTransitionMode(input: SetPipelineNodeTransitionModeInput) {
    try {
      const row = this.nodeRunByKey(input.pipelineRunId, input.nodeKey);
      if (!row) throw new DomainError("Pipeline node run was not found", "PIPELINE_NODE_NOT_FOUND");
      this.database.orm.update(pipelineNodes).set({ startMode: input.mode })
        .where(eq(pipelineNodes.id, row.node.id)).run();
      const pipelineRun = await this.showRun(input.pipelineRunId);
      if (!pipelineRun) throw new DomainError("Pipeline run was not found", "PIPELINE_RUN_NOT_FOUND");
      return { pipelineRun };
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async approveNodeTransition(input: ApprovePipelineNodeTransitionInput) {
    try {
      const row = this.nodeRunByKey(input.pipelineRunId, input.nodeKey);
      if (!row) throw new DomainError("Pipeline node run was not found", "PIPELINE_NODE_NOT_FOUND");
      this.database.orm.update(pipelineNodes).set({ startMode: "auto" })
        .where(eq(pipelineNodes.id, row.node.id)).run();
      await this.reconcile(input.pipelineRunId, input.context.occurredAt);
      const pipelineRun = await this.showRun(input.pipelineRunId);
      if (!pipelineRun) throw new DomainError("Pipeline run was not found", "PIPELINE_RUN_NOT_FOUND");
      return { pipelineRun };
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async publishNodeHandover(input: PublishPipelineNodeHandoverInput) {
    try {
      const row = this.nodeRunByKey(input.pipelineRunId, input.nodeKey);
      if (!row) throw new DomainError("Pipeline node run was not found", "PIPELINE_NODE_NOT_FOUND");
      const latest = this.database.orm.select({ body: conversationItems.body, runId: runs.id })
        .from(runs)
        .innerJoin(conversationItems, eq(conversationItems.conversationId, runs.conversationId))
        .where(and(
          eq(runs.missionId, row.mission.id),
          eq(conversationItems.kind, "assistant")
        ))
        .orderBy(desc(conversationItems.createdAt), desc(conversationItems.ordinal))
        .get();
      if (!latest?.body?.trim()) {
        throw new DomainError("No assistant message is available for handover", "HANDOVER_SOURCE_MISSING");
      }
      const incoming = this.database.orm.select().from(pipelineEdges)
        .where(eq(pipelineEdges.fromNodeId, row.node.id)).all();
      let count = 0;
      for (const edge of incoming) {
        const target = this.nodeRows(input.pipelineRunId).find((candidate) => candidate.node.id === edge.toNodeId);
        if (!target) continue;
        this.upsertHandover(
          row.nodeRun.id,
          latest.runId,
          target.nodeRun.id,
          {
            schemaVersion: 1,
            source: "assistant_message",
            fromNodeKey: row.node.nodeKey,
            missionId: row.mission.id,
            message: latest.body,
            publishedAt: input.context.occurredAt
          },
          input.context.occurredAt
        );
        count += 1;
      }
      const pipelineRun = await this.showRun(input.pipelineRunId);
      if (!pipelineRun) throw new DomainError("Pipeline run was not found", "PIPELINE_RUN_NOT_FOUND");
      return { pipelineRun, handoverCount: count };
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  private async reconcile(pipelineRunId: Id, now: string): Promise<void> {
    this.database.orm.transaction((transaction) => {
      let transitionBlocked = false;
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
        if (predecessorsDone && row.node.startMode === "auto") {
          this.createIncomingHandovers(row.nodeRun.id, incoming, fresh, now);
          transaction.update(pipelineNodeRuns).set({ state: "ready" })
            .where(eq(pipelineNodeRuns.id, row.nodeRun.id)).run();
        } else if (predecessorsDone && row.node.startMode === "human") {
          transitionBlocked = true;
          transaction.update(pipelineRuns).set({ state: "blocked" })
            .where(eq(pipelineRuns.id, pipelineRunId)).run();
          transaction.update(relayItems).set({ queue: "decision_required", reasonCode: "pipeline_transition_requires_human" })
            .where(eq(relayItems.pipelineRunId, pipelineRunId)).run();
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
      } else if (!transitionBlocked) {
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

  private readListItem(pipeline: typeof pipelines.$inferSelect): PipelineListItemView {
    const definition = this.database.orm.select().from(pipelineDefinitions)
      .where(eq(pipelineDefinitions.pipelineId, pipeline.id))
      .orderBy(asc(pipelineDefinitions.version))
      .get();
    const latestRun = this.database.orm.select().from(pipelineRuns)
      .where(eq(pipelineRuns.pipelineId, pipeline.id))
      .orderBy(desc(pipelineRuns.createdAt))
      .get();
    const nodeRunStateByNodeId = new Map<string, PipelineRunView["nodes"][number]["state"]>();
    if (latestRun) {
      for (const nodeRun of this.database.orm.select().from(pipelineNodeRuns)
        .where(eq(pipelineNodeRuns.pipelineRunId, latestRun.id)).all()) {
        nodeRunStateByNodeId.set(nodeRun.nodeId, nodeRun.state);
      }
    }
    const nodeRows = definition
      ? this.database.orm.select({ node: pipelineNodes, mission: missions })
          .from(pipelineNodes)
          .innerJoin(missions, eq(missions.id, pipelineNodes.missionId))
          .where(eq(pipelineNodes.definitionId, definition.id))
          .orderBy(asc(pipelineNodes.nodeKey), asc(pipelineNodes.id))
          .all()
      : [];
    const latestRunByMission = this.latestRunByMission(nodeRows.map((row) => row.mission.id));
    const nodeKeyById = new Map(nodeRows.map((row) => [row.node.id, row.node.nodeKey]));
    const edges = definition
      ? this.database.orm.select().from(pipelineEdges)
          .where(eq(pipelineEdges.definitionId, definition.id))
          .orderBy(asc(pipelineEdges.id))
          .all()
          .flatMap((edge) => {
            const fromNodeKey = nodeKeyById.get(edge.fromNodeId);
            const toNodeKey = nodeKeyById.get(edge.toNodeId);
            return fromNodeKey && toNodeKey ? [{ fromNodeKey, toNodeKey }] : [];
          })
      : [];
    const nodes = nodeRows.map((row) => {
      const latest = latestRunByMission.get(row.mission.id);
      return {
        nodeKey: row.node.nodeKey,
        missionId: asId(row.mission.id),
        missionTitle: row.mission.title,
        missionKind: row.mission.executionKind,
        missionState: row.mission.state,
        nodeRunState: nodeRunStateByNodeId.get(row.node.id) ?? null,
        transitionMode: row.node.startMode,
        runStartedAt: latest?.startedAt ?? null,
        runEndedAt: latest?.endedAt ?? null,
        runAttempt: latest?.userAttempt ?? null,
        runCostMicros: latest?.costMicros ?? null
      };
    });
    return {
      id: asId(pipeline.id),
      name: pipeline.name,
      state: pipeline.state,
      createdAt: pipeline.createdAt,
      runId: latestRun ? asId(latestRun.id) : null,
      runState: latestRun ? latestRun.state : null,
      startedAt: latestRun?.startedAt ?? null,
      endedAt: latestRun?.endedAt ?? null,
      totalCostMicros: totalCost(nodes),
      nodes,
      edges
    };
  }

  private readRun(id: Id): PipelineRunView | null {
    const run = this.database.orm.select().from(pipelineRuns).where(eq(pipelineRuns.id, id)).get();
    if (!run) return null;
    const nodes = this.nodeRows(id);
    const latestRunByMission = this.latestRunByMission(nodes.map((row) => row.mission.id));
    const nodeViews = nodes.map((row) => {
      const latest = latestRunByMission.get(row.mission.id);
      return {
        id: asId(row.nodeRun.id),
        nodeId: asId(row.node.id),
        nodeKey: row.node.nodeKey,
        missionId: asId(row.mission.id),
        missionKind: row.mission.executionKind,
        missionState: row.mission.state,
        state: row.nodeRun.state,
        transitionMode: row.node.startMode,
        userAttempt: row.nodeRun.userAttempt,
        runStartedAt: latest?.startedAt ?? null,
        runEndedAt: latest?.endedAt ?? null,
        runCostMicros: latest?.costMicros ?? null,
        handovers: this.incomingHandovers(row.nodeRun.id)
      };
    });
    return {
      id: asId(run.id),
      pipelineId: asId(run.pipelineId),
      definitionId: asId(run.definitionId),
      state: run.state,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      createdAt: run.createdAt,
      totalCostMicros: totalCost(nodeViews),
      nodes: nodeViews
    };
  }

  /** Dernier run de mission (tentative la plus récente) pour chaque mission, en une seule requête batch. */
  private latestRunByMission(missionIds: string[]): Map<string, { startedAt: string | null; endedAt: string | null; userAttempt: number; costMicros: number | null }> {
    const uniqueIds = [...new Set(missionIds)];
    if (uniqueIds.length === 0) return new Map();
    const rows = this.database.orm.select()
      .from(runs)
      .where(inArray(runs.missionId, uniqueIds))
      .orderBy(desc(runs.userAttempt), desc(runs.createdAt))
      .all();
    const latest = new Map<string, { startedAt: string | null; endedAt: string | null; userAttempt: number; costMicros: number | null }>();
    for (const row of rows) {
      if (!row.missionId || latest.has(row.missionId)) continue;
      latest.set(row.missionId, {
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        userAttempt: row.userAttempt,
        costMicros: row.costMicros ?? null
      });
    }
    return latest;
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

  private nodeRunByKey(pipelineRunId: Id, nodeKey: string) {
    return this.nodeRows(pipelineRunId).find((row) => row.node.nodeKey === nodeKey) ?? null;
  }

  private createIncomingHandovers(
    toNodeRunId: string,
    incoming: Array<typeof pipelineEdges.$inferSelect>,
    rows: ReturnType<SqlitePipelineRepository["nodeRows"]>,
    now: string
  ): void {
    for (const edge of incoming) {
      const predecessor = rows.find((row) => row.node.id === edge.fromNodeId);
      if (!predecessor) continue;
      const existing = this.database.orm.select({ id: handovers.id }).from(handovers)
        .where(and(
          eq(handovers.pipelineNodeRunId, predecessor.nodeRun.id),
          eq(handovers.toNodeRunId, toNodeRunId)
        ))
        .get();
      if (existing) continue;
      const message = this.latestAssistantMessage(predecessor.mission.id);
      this.upsertHandover(predecessor.nodeRun.id, message?.runId ?? null, toNodeRunId, {
        schemaVersion: 1,
        source: message?.body ? "assistant_message" : "mission_completion",
        fromNodeKey: predecessor.node.nodeKey,
        missionId: predecessor.mission.id,
        missionState: predecessor.mission.state,
        completedAt: predecessor.mission.updatedAt,
        ...(message?.body ? { message: message.body } : {})
      }, now);
    }
  }

  private latestAssistantMessage(missionId: string): { body: string; runId: string } | null {
    const latest = this.database.orm.select({ body: conversationItems.body, runId: runs.id })
      .from(runs)
      .innerJoin(conversationItems, eq(conversationItems.conversationId, runs.conversationId))
      .where(and(
        eq(runs.missionId, missionId),
        eq(conversationItems.kind, "assistant")
      ))
      .orderBy(desc(conversationItems.createdAt), desc(conversationItems.ordinal))
      .get();
    return latest?.body?.trim() ? { body: latest.body, runId: latest.runId } : null;
  }

  private upsertHandover(
    fromNodeRunId: string,
    fromRunId: string | null,
    toNodeRunId: string,
    payload: unknown,
    now: string
  ): void {
    this.database.orm.insert(handovers).values({
      id: `handover/${fromNodeRunId}/${toNodeRunId}`,
      pipelineNodeRunId: fromNodeRunId,
      fromRunId,
      toNodeRunId,
      payloadJson: JSON.stringify(payload),
      createdAt: now
    }).onConflictDoUpdate({
      target: handovers.id,
      set: {
        fromRunId,
        payloadJson: JSON.stringify(payload),
        createdAt: now
      }
    }).run();
  }

  private incomingHandovers(toNodeRunId: string) {
    return this.database.orm.select({ source: pipelineNodes.nodeKey, payload: handovers.payloadJson })
      .from(handovers)
      .innerJoin(pipelineNodeRuns, eq(pipelineNodeRuns.id, handovers.pipelineNodeRunId))
      .innerJoin(pipelineNodes, eq(pipelineNodes.id, pipelineNodeRuns.nodeId))
      .where(eq(handovers.toNodeRunId, toNodeRunId))
      .all()
      .map((row) => ({ fromNodeKey: row.source, payload: JSON.parse(row.payload) as unknown }));
  }

  private handoverPrompt(handovers: Array<{ fromNodeKey: string; payload: unknown }>): string | null {
    if (handovers.length === 0) return null;
    return handovers.map((handover) => {
      const payload = handover.payload as { message?: unknown };
      const content = typeof payload.message === "string"
        ? payload.message
        : JSON.stringify(handover.payload);
      return `<resultat_etape_precedente id="${handover.fromNodeKey}">\n${content}\n</resultat_etape_precedente>`;
    }).join("\n\n");
  }
}

/** Somme des coûts connus (micro-dollars) d'une liste de nœuds ; null si aucun coût renseigné. */
function totalCost(nodes: Array<{ runCostMicros: number | null }>): number | null {
  let total = 0;
  let known = 0;
  for (const node of nodes) {
    if (node.runCostMicros !== null) {
      total += node.runCostMicros;
      known += 1;
    }
  }
  return known > 0 ? total : null;
}
