import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import type {
  ChangeMissionState,
  CreateMission,
  HumanMissionAction,
  ListMissions,
  MissionListFilter,
  StartMission,
  ShowMission
} from "@nodra/application";
import { toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import { CHANGE_MISSION_STATE, CREATE_MISSION, LIST_MISSIONS, SHOW_MISSION, START_MISSION } from "./tokens.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { CreateMissionDto } from "./dto/mission.dto.js";
import { BlockMissionDto } from "./dto/block-mission.dto.js";
import { MissionTransitionDto } from "./dto/mission-transition.dto.js";

@Controller("api/missions")
export class MissionController {
  constructor(
    @Inject(CREATE_MISSION) private readonly createMission: CreateMission,
    @Inject(CHANGE_MISSION_STATE) private readonly changeMissionState: ChangeMissionState,
    @Inject(LIST_MISSIONS) private readonly listMissions: ListMissions,
    @Inject(SHOW_MISSION) private readonly showMission: ShowMission,
    @Inject(START_MISSION) private readonly startMission: StartMission
  ) {}

  @Post()
  @HttpCode(201)
  create(@Body() body: CreateMissionDto) {
    return this.createMission.execute({
      id: toId(randomUUID()),
      title: body.title,
      context: this.context(body.commandId),
      ...(body.projectId === undefined || body.projectId === null ? {} : { projectId: toId(body.projectId) })
    });
  }

  @Get()
  list(@Query("projectId") projectId?: string) {
    return this.listMissions.execute(this.filter(projectId));
  }

  @Get(":id")
  show(@Param("id") id: string) {
    return this.showMission.execute(toId(id));
  }

  @Post(":id/ready")
  ready(@Param("id") id: string, @Body() body: MissionTransitionDto) {
    return this.transition(id, body, { type: "prepare" });
  }

  @Post(":id/start")
  @HttpCode(202)
  start(@Param("id") id: string, @Body() body: MissionTransitionDto) {
    const context = this.context(body.commandId);
    return this.startMission.execute({
      missionId: toId(id),
      expectedVersion: body.expectedVersion,
      runId: toId(randomUUID()),
      conversationId: toId(randomUUID()),
      auditId: toId(`audit/${context.commandId}`),
      outboxId: toId(`outbox/${context.commandId}`),
      context
    });
  }

  @Post(":id/pickup")
  pickup(@Param("id") id: string, @Body() body: MissionTransitionDto) {
    return this.transition(id, body, { type: "pickup" });
  }

  @Post(":id/block")
  block(@Param("id") id: string, @Body() body: BlockMissionDto) {
    return this.transition(id, body, { type: "block", reason: body.reason });
  }

  @Post(":id/unblock")
  unblock(@Param("id") id: string, @Body() body: MissionTransitionDto) {
    return this.transition(id, body, { type: "resume" });
  }

  @Post(":id/complete")
  complete(@Param("id") id: string, @Body() body: MissionTransitionDto) {
    return this.transition(id, body, { type: "close" });
  }

  @Post(":id/abandon")
  abandon(@Param("id") id: string, @Body() body: MissionTransitionDto) {
    return this.transition(id, body, { type: "abandon" });
  }

  private transition(id: string, body: MissionTransitionDto | BlockMissionDto, action: HumanMissionAction) {
    return this.changeMissionState.execute({
      missionId: toId(id),
      expectedVersion: body.expectedVersion,
      action,
      context: this.context(body.commandId)
    });
  }

  private context(commandId?: string) {
    return {
      commandId: toId(commandId ?? randomUUID()),
      actor: "user" as const,
      occurredAt: new Date().toISOString()
    };
  }

  private filter(projectId?: string): MissionListFilter | undefined {
    return projectId === undefined ? undefined : { projectId: toId(projectId) };
  }

}
