import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import type {
  AttachProviderSession,
  CreateActiveMissionForProviderSession,
  GetProviderSessionSyncCapabilities,
  ListProviderSessions,
  ShowProviderSession
} from "@nodra/application";
import { toId } from "@nodra/application";
import { ATTACH_PROVIDER_SESSION, CREATE_ACTIVE_MISSION_FOR_PROVIDER_SESSION, GET_PROVIDER_SESSION_SYNC_CAPABILITIES, LIST_PROVIDER_SESSIONS, SHOW_PROVIDER_SESSION } from "./tokens.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { AttachProviderSessionDto } from "./dto/attach-provider-session.dto.js";
import { CreateProviderSessionMissionDto } from "./dto/create-provider-session-mission.dto.js";
import { ProviderSessionCapabilitiesQueryDto } from "./dto/provider-session-capabilities-query.dto.js";
import { ProviderSessionIdDto } from "./dto/provider-session-id.dto.js";
import { ProviderSessionListQueryDto } from "./dto/provider-session-list-query.dto.js";

@Controller("api/provider-sessions")
export class ProviderSessionController {
  constructor(
    @Inject(GET_PROVIDER_SESSION_SYNC_CAPABILITIES) private readonly capabilities: GetProviderSessionSyncCapabilities,
    @Inject(LIST_PROVIDER_SESSIONS) private readonly list: ListProviderSessions,
    @Inject(SHOW_PROVIDER_SESSION) private readonly show: ShowProviderSession,
    @Inject(ATTACH_PROVIDER_SESSION) private readonly attachSession: AttachProviderSession,
    @Inject(CREATE_ACTIVE_MISSION_FOR_PROVIDER_SESSION) private readonly createMission: CreateActiveMissionForProviderSession
  ) {}

  @Get("capabilities")
  capabilitiesFor(@Query() query: ProviderSessionCapabilitiesQueryDto) {
    return this.capabilities.execute(query.providerId);
  }

  @Get()
  listSessions(@Query() query: ProviderSessionListQueryDto) {
    return this.list.execute({
      providerId: query.providerId,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: Number(query.limit) })
    });
  }

  @Get(":id")
  showSession(@Param() params: ProviderSessionIdDto) {
    return this.show.execute(toId(params.id));
  }

  @Post(":id/refresh")
  @HttpCode(200)
  refresh(@Param() params: ProviderSessionIdDto) {
    return this.show.execute(toId(params.id));
  }

  @Post(":id/attach")
  @HttpCode(200)
  attach(@Param() params: ProviderSessionIdDto, @Body() body: AttachProviderSessionDto) {
    return this.attachSession.execute({
      providerSessionId: toId(params.id), missionId: toId(body.missionId), commandId: toId(body.commandId),
      actor: "user", occurredAt: new Date().toISOString()
    });
  }

  @Post(":id/missions")
  create(@Param() params: ProviderSessionIdDto, @Body() body: CreateProviderSessionMissionDto) {
    return this.createMission.execute({
      providerSessionId: toId(params.id), ...(body.title === undefined ? {} : { title: body.title }), projectId: body.projectId ? toId(body.projectId) : null,
      commandId: toId(body.commandId), actor: "user", occurredAt: new Date().toISOString()
    });
  }
}
