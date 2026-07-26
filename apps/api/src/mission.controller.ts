import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Put, Query } from "@nestjs/common";
import type {
  ChangeMissionState,
  CreateMission,
  HumanMissionAction,
  ListMissions,
  MissionListFilter,
  StartMission,
  ShowMission,
  EnableAgentConfig,
  GetAgentConfig,
  PreviewAgentConfig,
  UpdateAgentConfig
} from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import {
  CHANGE_MISSION_STATE,
  CREATE_MISSION,
  ENABLE_AGENT_CONFIG,
  GET_AGENT_CONFIG,
  LIST_MISSIONS,
  PREVIEW_AGENT_CONFIG,
  SHOW_MISSION,
  START_MISSION,
  UPDATE_AGENT_CONFIG
} from "./tokens.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { CreateMissionDto } from "./dto/mission.dto.js";
import { BlockMissionDto } from "./dto/block-mission.dto.js";
import { MissionTransitionDto } from "./dto/mission-transition.dto.js";
import { EnableAgentConfigDto } from "./dto/enable-agent-config.dto.js";
import { UpdateAgentConfigDto } from "./dto/update-agent-config.dto.js";

@Controller("api/missions")
export class MissionController {
  constructor(
    @Inject(CREATE_MISSION) private readonly createMission: CreateMission,
    @Inject(CHANGE_MISSION_STATE) private readonly changeMissionState: ChangeMissionState,
    @Inject(LIST_MISSIONS) private readonly listMissions: ListMissions,
    @Inject(SHOW_MISSION) private readonly showMission: ShowMission,
    @Inject(START_MISSION) private readonly startMission: StartMission,
    @Inject(ENABLE_AGENT_CONFIG) private readonly enableAgentConfig: EnableAgentConfig,
    @Inject(GET_AGENT_CONFIG) private readonly getAgentConfig: GetAgentConfig,
    @Inject(UPDATE_AGENT_CONFIG) private readonly updateAgentConfig: UpdateAgentConfig,
    @Inject(PREVIEW_AGENT_CONFIG) private readonly previewAgentConfig: PreviewAgentConfig
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

  @Post(":id/agent-config/enable")
  enableAgent(@Param("id") id: string, @Body() body: EnableAgentConfigDto) {
    return this.enableAgentConfig.execute({
      missionId: toId(id),
      expectedVersion: body.expectedVersion,
      context: this.context(body.commandId)
    });
  }

  @Get(":id/agent-config")
  agentConfig(@Param("id") id: string) {
    return this.getAgentConfig.execute(toId(id));
  }

  @Put(":id/agent-config")
  updateAgent(
    @Param("id") id: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: UpdateAgentConfigDto
  ) {
    return this.updateAgentConfig.execute({
      missionId: toId(id),
      expectedVersion: this.expectedConfigVersion(body.expectedVersion, ifMatch),
      values: {
        providerId: body.providerId,
        modelId: body.modelId,
        reasoningEffort: body.reasoningEffort,
        providerOptions: body.providerOptions,
        missionPrompt: body.missionPrompt,
        permissionPreset: body.permissionPreset,
        workspaceId: toId(body.workspaceId),
        autoCommitAuthorized: body.autoCommitAuthorized,
        integrationTargetRef: body.integrationTargetRef ?? null
      },
      context: this.context(body.commandId)
    });
  }

  @Post(":id/agent-config/preview")
  previewAgent(@Param("id") id: string) {
    return this.previewAgentConfig.execute(toId(id));
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

  private expectedConfigVersion(bodyVersion: number | undefined, ifMatch: string | undefined): number {
    const headerVersion = ifMatch === undefined
      ? undefined
      : Number(ifMatch.replace(/^W\//, "").replaceAll("\"", ""));
    if (
      (bodyVersion === undefined && headerVersion === undefined)
      || (headerVersion !== undefined && (!Number.isInteger(headerVersion) || headerVersion < 0))
      || (bodyVersion !== undefined && headerVersion !== undefined && bodyVersion !== headerVersion)
    ) {
      throw new DomainError("A coherent expectedVersion or If-Match header is required", "REQUEST_INVALID");
    }
    return bodyVersion ?? headerVersion!;
  }

}
