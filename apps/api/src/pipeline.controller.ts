import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type {
  AdvancePipeline,
  ApprovePipelineNodeTransition,
  CreatePipeline,
  PublishPipelineNodeHandover,
  ShowMission,
  ShowPipeline,
  ShowPipelineRun,
  SetPipelineNodeTransitionMode,
  StartMission,
  StartPipeline
} from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import { commandContext } from "./command-context.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { AdvancePipelineDto, CreatePipelineDto, SetPipelineTransitionModeDto, StartPipelineDto } from "./dto/pipeline.dto.js";
import {
  ADVANCE_PIPELINE,
  APPROVE_PIPELINE_NODE_TRANSITION,
  CREATE_PIPELINE,
  PUBLISH_PIPELINE_NODE_HANDOVER,
  SET_PIPELINE_NODE_TRANSITION_MODE,
  SHOW_MISSION,
  SHOW_PIPELINE,
  SHOW_PIPELINE_RUN,
  START_MISSION,
  START_PIPELINE
} from "./tokens.js";

@Controller("api/pipelines")
export class PipelineController {
  constructor(
    @Inject(CREATE_PIPELINE) private readonly createPipeline: CreatePipeline,
    @Inject(SHOW_PIPELINE) private readonly showPipeline: ShowPipeline,
    @Inject(SHOW_PIPELINE_RUN) private readonly showPipelineRun: ShowPipelineRun,
    @Inject(START_PIPELINE) private readonly startPipeline: StartPipeline,
    @Inject(ADVANCE_PIPELINE) private readonly advancePipeline: AdvancePipeline,
    @Inject(SET_PIPELINE_NODE_TRANSITION_MODE) private readonly setTransitionMode: SetPipelineNodeTransitionMode,
    @Inject(APPROVE_PIPELINE_NODE_TRANSITION) private readonly approveTransition: ApprovePipelineNodeTransition,
    @Inject(PUBLISH_PIPELINE_NODE_HANDOVER) private readonly publishHandover: PublishPipelineNodeHandover,
    @Inject(SHOW_MISSION) private readonly showMission: ShowMission,
    @Inject(START_MISSION) private readonly startMission: StartMission
  ) {}

  @Post()
  create(@Body() body: CreatePipelineDto) {
    const pipelineId = toId(body.id ?? randomUUID());
    return this.createPipeline.execute({
      pipelineId,
      definitionId: toId(`${pipelineId}/definition/1`),
      nodeIdPrefix: `${pipelineId}/node`,
      edgeIdPrefix: `${pipelineId}/edge`,
      name: body.name,
      nodes: body.nodes.map((node) => ({ nodeKey: node.nodeKey, missionId: toId(node.missionId) })),
      ...(body.edges?.length ? { edges: body.edges } : {}),
      context: commandContext(body.commandId)
    });
  }

  @Get(":id")
  show(@Param("id") id: string) {
    return this.showPipeline.execute(toId(id));
  }

  @Post(":id/start")
  async start(@Param("id") id: string, @Body() body: StartPipelineDto) {
    const context = commandContext(body.commandId);
    const pipelineRunId = toId(body.runId ?? randomUUID());
    await this.startPipeline.execute({
      pipelineId: toId(id),
      pipelineRunId,
      nodeRunIdPrefix: `${pipelineRunId}/node-run`,
      context
    });
    return this.advanceRun(pipelineRunId, context);
  }

  @Get("runs/:id")
  showRun(@Param("id") id: string) {
    return this.showPipelineRun.execute(toId(id));
  }

  @Post("runs/:id/advance")
  advance(@Param("id") id: string, @Body() body: AdvancePipelineDto) {
    return this.advanceRun(toId(id), commandContext(body.commandId));
  }

  @Post("runs/:id/nodes/:nodeKey/mode")
  mode(
    @Param("id") id: string,
    @Param("nodeKey") nodeKey: string,
    @Body() body: SetPipelineTransitionModeDto
  ) {
    return this.setTransitionMode.execute({
      pipelineRunId: toId(id),
      nodeKey,
      mode: body.mode,
      context: commandContext(body.commandId)
    });
  }

  @Post("runs/:id/nodes/:nodeKey/approve-transition")
  approveTransitionForNode(
    @Param("id") id: string,
    @Param("nodeKey") nodeKey: string,
    @Body() body: AdvancePipelineDto
  ) {
    return this.approveTransition.execute({
      pipelineRunId: toId(id),
      nodeKey,
      context: commandContext(body.commandId)
    });
  }

  @Post("runs/:id/nodes/:nodeKey/publish-handover")
  publishHandoverForNode(
    @Param("id") id: string,
    @Param("nodeKey") nodeKey: string,
    @Body() body: AdvancePipelineDto
  ) {
    return this.publishHandover.execute({
      pipelineRunId: toId(id),
      nodeKey,
      context: commandContext(body.commandId)
    });
  }

  private advanceRun(pipelineRunId: ReturnType<typeof toId>, context: ReturnType<typeof commandContext>) {
    return this.advancePipeline.execute({
      pipelineRunId,
      context,
      startMission: async (missionId, handoverPrompt) => {
        const mission = await this.showMission.execute(missionId);
        if (!mission) throw new DomainError(`Mission ${missionId} was not found`, "MISSION_NOT_FOUND");
        const commandId = toId(randomUUID());
        await this.startMission.execute({
          missionId,
          expectedVersion: mission.version,
          runId: toId(randomUUID()),
          conversationId: toId(randomUUID()),
          auditId: toId(`audit/${commandId}`),
          outboxId: toId(`outbox/${commandId}`),
          handoverPrompt,
          context: {
            commandId,
            actor: context.actor,
            occurredAt: context.occurredAt
          }
        });
      }
    });
  }
}
