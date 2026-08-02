import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Put, Query } from "@nestjs/common";
import type {
  ActivateProviderSessionMission,
  ChangeMissionState,
  CreateMission,
  EnsureMissionObservationSession,
  HumanMissionAction,
  ListMissions,
  ListMissionAudit,
  ListMissionRuns,
  MissionListFilter,
  StartMission,
  ShowMission,
  EnableAgentConfig,
  GetAgentConfig,
  GetMissionProviderSessionControlCapabilities,
  PreviewAgentConfig,
  ReadMissionProviderSession,
  StartProviderSessionTurn,
  SteerProviderSessionTurn,
  UpdateAgentConfig
} from "@nodra/application";
import { DomainError, toId, type ProviderReasoningEffort } from "@nodra/application";
import { randomUUID } from "node:crypto";
import {
  ACTIVATE_PROVIDER_SESSION_MISSION,
  CHANGE_MISSION_STATE,
  CREATE_MISSION,
  ENABLE_AGENT_CONFIG,
  ENSURE_MISSION_OBSERVATION_SESSION,
  GET_AGENT_CONFIG,
  GET_MISSION_PROVIDER_SESSION_CONTROL_CAPABILITIES,
  LIST_MISSIONS,
  LIST_MISSION_AUDIT,
  LIST_MISSION_RUNS,
  PREVIEW_AGENT_CONFIG,
  READ_MISSION_PROVIDER_SESSION,
  SHOW_MISSION,
  START_MISSION,
  START_PROVIDER_SESSION_TURN,
  STEER_PROVIDER_SESSION_TURN,
  UPDATE_AGENT_CONFIG
} from "./tokens.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { CreateMissionDto } from "./dto/mission.dto.js";
import { BlockMissionDto } from "./dto/block-mission.dto.js";
import { MissionTransitionDto } from "./dto/mission-transition.dto.js";
import { SubmitMissionDto } from "./dto/submit-mission.dto.js";
import { EnableAgentConfigDto } from "./dto/enable-agent-config.dto.js";
import { UpdateAgentConfigDto } from "./dto/update-agent-config.dto.js";
import { MissionLookupQueryDto } from "./dto/mission-lookup-query.dto.js";
import { ActivateProviderSessionMissionDto } from "./dto/activate-provider-session-mission.dto.js";
import { StartProviderSessionTurnDto } from "./dto/start-provider-session-turn.dto.js";
import { SteerProviderSessionTurnDto } from "./dto/steer-provider-session-turn.dto.js";
import { EnsureMissionObservationSessionDto } from "./dto/ensure-mission-observation-session.dto.js";

@Controller("api/missions")
export class MissionController {
  constructor(
    @Inject(CREATE_MISSION) private readonly createMission: CreateMission,
    @Inject(CHANGE_MISSION_STATE) private readonly changeMissionState: ChangeMissionState,
    @Inject(LIST_MISSIONS) private readonly listMissions: ListMissions,
    @Inject(LIST_MISSION_RUNS) private readonly listMissionRuns: ListMissionRuns,
    @Inject(LIST_MISSION_AUDIT) private readonly listMissionAudit: ListMissionAudit,
    @Inject(SHOW_MISSION) private readonly showMission: ShowMission,
    @Inject(START_MISSION) private readonly startMission: StartMission,
    @Inject(ENABLE_AGENT_CONFIG) private readonly enableAgentConfig: EnableAgentConfig,
    @Inject(GET_AGENT_CONFIG) private readonly getAgentConfig: GetAgentConfig,
    @Inject(UPDATE_AGENT_CONFIG) private readonly updateAgentConfig: UpdateAgentConfig,
    @Inject(PREVIEW_AGENT_CONFIG) private readonly previewAgentConfig: PreviewAgentConfig,
    @Inject(READ_MISSION_PROVIDER_SESSION) private readonly readProviderSession: ReadMissionProviderSession,
    @Inject(GET_MISSION_PROVIDER_SESSION_CONTROL_CAPABILITIES) private readonly providerSessionControlCapabilities: GetMissionProviderSessionControlCapabilities,
    @Inject(ACTIVATE_PROVIDER_SESSION_MISSION) private readonly activateProviderSession: ActivateProviderSessionMission,
    @Inject(ENSURE_MISSION_OBSERVATION_SESSION) private readonly ensureObservationSession: EnsureMissionObservationSession,
    @Inject(START_PROVIDER_SESSION_TURN) private readonly startProviderTurn: StartProviderSessionTurn,
    @Inject(STEER_PROVIDER_SESSION_TURN) private readonly steerProviderTurn: SteerProviderSessionTurn
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

  @Get("lookup")
  lookup(@Query() query: MissionLookupQueryDto) {
    return this.showMission.execute(toId(query.missionId));
  }

  @Get(":id")
  show(@Param("id") id: string) {
    return this.showMission.execute(toId(id));
  }

  /**
   * Historique des runs d'une mission avec usage (tokens) et coût, du plus
   * ancien au plus récent, plus le coût total cumulé. Le coût est celui
   * rapporté par le provider (costMicros, micro-dollars) quand il existe.
   */
  @Get(":id/runs")
  runs(@Param("id") id: string) {
    return this.listMissionRuns.execute(toId(id));
  }

  /**
   * Timeline d'audit de la mission (transitions d'état, décisions humaines,
   * commandes), du plus ancien au plus récent.
   */
  @Get(":id/audit")
  audit(@Param("id") id: string) {
    return this.listMissionAudit.execute(toId(id));
  }

  @Post(":id/ready")
  ready(@Param("id") id: string, @Body() body: MissionTransitionDto) {
    return this.transition(id, body, { type: "prepare" });
  }

  @Get(":id/provider-session")
  providerSession(@Param("id") id: string) {
    return this.readProviderSession.execute(toId(id));
  }

  @Get(":id/provider-session/capabilities")
  providerSessionCapabilities(@Param("id") id: string) {
    return this.providerSessionControlCapabilities.execute(toId(id));
  }

  @Post(":id/provider-session/activate")
  activateProviderSessionMission(@Param("id") id: string, @Body() body: ActivateProviderSessionMissionDto) {
    return this.activateProviderSession.execute({
      missionId: toId(id), expectedVersion: body.expectedVersion, commandId: toId(body.commandId),
      actor: "user", occurredAt: new Date().toISOString()
    });
  }

  @Post(":id/provider-session/ensure-observation")
  @HttpCode(200)
  ensureMissionObservationSession(@Param("id") id: string, @Body() body: EnsureMissionObservationSessionDto) {
    return this.ensureObservationSession.execute({
      missionId: toId(id), commandId: toId(body.commandId),
      actor: "user", occurredAt: new Date().toISOString()
    });
  }

  @Post(":id/provider-session/turns")
  @HttpCode(202)
  startProviderSessionTurn(@Param("id") id: string, @Body() body: StartProviderSessionTurnDto) {
    return this.startProviderTurn.execute({
      missionId: toId(id),
      commandId: toId(body.commandId),
      text: body.text,
      ...(body.modelId ? { modelId: body.modelId } : {}),
      ...(body.reasoningEffort ? { reasoningEffort: body.reasoningEffort as ProviderReasoningEffort } : {})
    });
  }

  @Post(":id/provider-session/steer")
  @HttpCode(202)
  steerProviderSessionTurn(@Param("id") id: string, @Body() body: SteerProviderSessionTurnDto) {
    return this.steerProviderTurn.execute({
      missionId: toId(id),
      commandId: toId(body.commandId),
      externalTurnId: body.externalTurnId,
      text: body.text,
      ...(body.modelId ? { modelId: body.modelId } : {}),
      ...(body.reasoningEffort ? { reasoningEffort: body.reasoningEffort as ProviderReasoningEffort } : {})
    });
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

  @Post(":id/accept")
  accept(@Param("id") id: string, @Body() body: MissionTransitionDto) {
    return this.transition(id, body, { type: "accept" });
  }

  @Post(":id/submit")
  submit(@Param("id") id: string, @Body() body: SubmitMissionDto) {
    return this.transition(id, body, { type: "submit", declaredResult: body.declaredResult ?? "" });
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
