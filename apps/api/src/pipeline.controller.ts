import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type {
  AdvancePipeline,
  CreatePipeline,
  ShowMission,
  ShowPipeline,
  ShowPipelineRun,
  StartMission,
  StartPipeline
} from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import { commandContext } from "./command-context.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { AdvancePipelineDto, CreatePipelineDto, StartPipelineDto } from "./dto/pipeline.dto.js";
import {
  ADVANCE_PIPELINE,
  CREATE_PIPELINE,
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

  private advanceRun(pipelineRunId: ReturnType<typeof toId>, context: ReturnType<typeof commandContext>) {
    return this.advancePipeline.execute({
      pipelineRunId,
      context,
      startMission: async (missionId) => {
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
