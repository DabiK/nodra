import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { NodraSqliteDatabase } from "@nodra/adapters";
import { conversationItems, conversations, providerEvents, runConfigSnapshots, runs } from "@nodra/adapters";
import type { ChangeMissionState, DispatchWorkflowOutbox, ShowMission, StartMission, SteerRun } from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { commandContext } from "./command-context.js";
import { CHANGE_MISSION_STATE, DATABASE, DISPATCH_WORKFLOW_OUTBOX, SHOW_MISSION, START_MISSION, STEER_RUN } from "./tokens.js";
import type { StartSessionDto } from "./dto/start-session.dto.js";

@Controller("api/agent-sessions")
export class AgentSessionController {
  constructor(
    @Inject(DATABASE) private readonly database: NodraSqliteDatabase,
    @Inject(SHOW_MISSION) private readonly showMission: ShowMission,
    @Inject(CHANGE_MISSION_STATE) private readonly changeMissionState: ChangeMissionState,
    @Inject(START_MISSION) private readonly startMission: StartMission,
    @Inject(STEER_RUN) private readonly steerRun: SteerRun,
    @Inject(DISPATCH_WORKFLOW_OUTBOX) private readonly dispatchOutbox: DispatchWorkflowOutbox
  ) {}

  @Post("missions/:id/start")
  async start(@Param("id") id: string, @Body() body: StartSessionDto) {
    const mission = await this.showMission.execute(toId(id));
    if (!mission) throw new DomainError(`Mission ${id} was not found`, "MISSION_NOT_FOUND");
    const context = commandContext(body.commandId);
    if (mission.state === "ACTIVE" && body.message?.trim()) {
      const run = this.database.orm.select().from(runs).where(eq(runs.missionId, id)).orderBy(desc(runs.createdAt)).limit(1).get();
      if (!run) throw new DomainError(`Mission ${id} has no run`, "RUN_NOT_FOUND");
      await this.steerRun.execute(toId(run.id), body.message.trim());
      return { runId: run.id, conversationId: run.conversationId, threadId: run.id };
    }
    let startVersion = body.expectedVersion ?? mission.version;
    if (mission.state === "DRAFT") {
      startVersion = (await this.changeMissionState.execute({
          missionId: toId(id),
          expectedVersion: body.expectedVersion ?? mission.version,
          action: { type: "prepare" },
          context: { ...context, commandId: toId(`${context.commandId}/prepare`) }
        })).version;
    } else if (mission.state === "VALIDATION" && body.message?.trim()) {
      startVersion = (await this.changeMissionState.execute({
        missionId: toId(id),
        expectedVersion: body.expectedVersion ?? mission.version,
        action: { type: "request-correction" },
        context: { ...context, commandId: toId(`${context.commandId}/request-correction`) }
      })).version;
    }
    const runId = toId(randomUUID());
    const conversationId = toId(randomUUID());
    await this.startMission.execute({
      missionId: toId(id),
      expectedVersion: startVersion,
      runId,
      conversationId,
      auditId: toId(`audit/${context.commandId}`),
      outboxId: toId(`outbox/${context.commandId}`),
      followUpMessage: body.message?.trim() ? body.message.trim() : null,
      context
    });
    await this.dispatchOutbox.execute({ limit: 20, occurredAt: new Date().toISOString() });
    return { runId, conversationId, threadId: runId };
  }

  @Get(":id")
  show(@Param("id") id: string) {
    const requested = this.database.orm.select().from(runs).where(eq(runs.id, id)).get();
    if (!requested) throw new DomainError(`Run ${id} was not found`, "RUN_NOT_FOUND");

    // Every run of a mission shares the same provider session, so a "thread" is
    // really the mission. Track the latest run for live state, but keep the URL
    // (requested run id) stable across follow-up messages.
    const missionRuns = requested.missionId
      ? this.database.orm.select().from(runs)
          .where(eq(runs.missionId, requested.missionId))
          .orderBy(runs.createdAt)
          .all()
      : [requested];
    const run = missionRuns[missionRuns.length - 1] ?? requested;

    const conversation = this.database.orm.select().from(conversations).where(eq(conversations.id, run.conversationId)).get();
    const config = this.database.orm.select({
      promptEffective: runConfigSnapshots.promptEffective,
      promptMission: runConfigSnapshots.promptMission,
      cwd: runConfigSnapshots.cwd,
      permissionPreset: runConfigSnapshots.permissionPreset
    }).from(runConfigSnapshots).where(eq(runConfigSnapshots.runId, run.id)).get();

    const items = missionRuns.flatMap((missionRun) =>
      this.database.orm.select().from(conversationItems)
        .where(eq(conversationItems.conversationId, missionRun.conversationId))
        .orderBy(conversationItems.ordinal)
        .all()
    );
    const events = missionRuns.flatMap((missionRun) =>
      this.database.orm.select().from(providerEvents)
        .where(eq(providerEvents.runId, missionRun.id))
        .orderBy(providerEvents.sequence)
        .all()
        .map((event) => ({ ...event, payload: JSON.parse(event.payloadJson) as unknown }))
    );
    return { run, conversation, config, items, events, threadId: id };
  }

  @Get("missions/:id/latest")
  latestForMission(@Param("id") id: string) {
    const run = this.database.orm.select().from(runs).where(eq(runs.missionId, id)).orderBy(desc(runs.createdAt)).limit(1).get();
    if (!run) throw new DomainError(`Mission ${id} has no run`, "RUN_NOT_FOUND");
    return { runId: run.id, threadId: run.id };
  }
}
