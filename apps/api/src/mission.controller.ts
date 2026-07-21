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
import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import { CHANGE_MISSION_STATE, CREATE_MISSION, LIST_MISSIONS, SHOW_MISSION, START_MISSION } from "./tokens.js";

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
  create(@Body() value: unknown) {
    const body = this.objectBody(value);
    this.assertKeys(body, ["title", "projectId", "commandId"]);
    const title = body.title;
    if (typeof title !== "string") throw new DomainError("title must be a string", "REQUEST_INVALID");
    const projectId = body.projectId;
    if (projectId !== undefined && projectId !== null && typeof projectId !== "string") {
      throw new DomainError("projectId must be a string or null", "REQUEST_INVALID");
    }
    return this.createMission.execute({
      id: toId(randomUUID()),
      title,
      context: this.context(body.commandId),
      ...(projectId === undefined || projectId === null ? {} : { projectId: toId(projectId) })
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
  ready(@Param("id") id: string, @Body() value: unknown) {
    return this.transition(id, value, { type: "prepare" });
  }

  @Post(":id/start")
  @HttpCode(202)
  start(@Param("id") id: string, @Body() value: unknown) {
    const body = this.objectBody(value);
    this.assertKeys(body, ["expectedVersion", "commandId"]);
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) {
      throw new DomainError("expectedVersion must be a non-negative integer", "REQUEST_INVALID");
    }
    const context = this.context(body.commandId);
    return this.startMission.execute({
      missionId: toId(id),
      expectedVersion: Number(body.expectedVersion),
      runId: toId(randomUUID()),
      conversationId: toId(randomUUID()),
      auditId: toId(`audit/${context.commandId}`),
      outboxId: toId(`outbox/${context.commandId}`),
      context
    });
  }

  @Post(":id/pickup")
  pickup(@Param("id") id: string, @Body() value: unknown) {
    return this.transition(id, value, { type: "pickup" });
  }

  @Post(":id/block")
  block(@Param("id") id: string, @Body() value: unknown) {
    const body = this.objectBody(value);
    if (typeof body.reason !== "string") throw new DomainError("reason must be a string", "REQUEST_INVALID");
    return this.transition(id, body, { type: "block", reason: body.reason });
  }

  @Post(":id/unblock")
  unblock(@Param("id") id: string, @Body() value: unknown) {
    return this.transition(id, value, { type: "resume" });
  }

  @Post(":id/complete")
  complete(@Param("id") id: string, @Body() value: unknown) {
    return this.transition(id, value, { type: "close" });
  }

  @Post(":id/abandon")
  abandon(@Param("id") id: string, @Body() value: unknown) {
    return this.transition(id, value, { type: "abandon" });
  }

  private transition(id: string, value: unknown, action: HumanMissionAction) {
    const body = this.objectBody(value);
    this.assertKeys(body, action.type === "block" ? ["expectedVersion", "commandId", "reason"] : ["expectedVersion", "commandId"]);
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) {
      throw new DomainError("expectedVersion must be a non-negative integer", "REQUEST_INVALID");
    }
    return this.changeMissionState.execute({
      missionId: toId(id),
      expectedVersion: Number(body.expectedVersion),
      action,
      context: this.context(body.commandId)
    });
  }

  private context(commandId: unknown) {
    if (commandId !== undefined && typeof commandId !== "string") {
      throw new DomainError("commandId must be a string", "REQUEST_INVALID");
    }
    return {
      commandId: toId(typeof commandId === "string" ? commandId : randomUUID()),
      actor: "user" as const,
      occurredAt: new Date().toISOString()
    };
  }

  private filter(projectId?: string): MissionListFilter | undefined {
    return projectId === undefined ? undefined : { projectId: toId(projectId) };
  }

  private objectBody(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new DomainError("A JSON object body is required", "REQUEST_INVALID");
    }
    return value as Record<string, unknown>;
  }

  private assertKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
    const unexpected = Object.keys(body).filter((key) => !allowed.includes(key));
    if (unexpected.length > 0) {
      throw new DomainError(`Unexpected field(s): ${unexpected.join(", ")}`, "REQUEST_INVALID");
    }
  }
}
