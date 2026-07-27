import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { asc, desc, eq, inArray } from "drizzle-orm";
import type { NodraSqliteDatabase } from "@nodra/adapters";
import { conversationItems, conversations, providerEvents, runConfigSnapshots, runs } from "@nodra/adapters";
import type {
  ArchiveManager,
  CreateManager,
  DispatchWorkflowOutbox,
  ListManagerConversations,
  ListManagers,
  ShowManager,
  StartManagerRun,
  SteerRun,
  UpdateManager
} from "@nodra/application";
import type { ManagerConfig } from "@nodra/domain";
import { DomainError, toId } from "@nodra/application";
import { commandContext } from "./command-context.js";
import {
  ARCHIVE_MANAGER,
  CREATE_MANAGER,
  DATABASE,
  DISPATCH_WORKFLOW_OUTBOX,
  LIST_MANAGER_CONVERSATIONS,
  LIST_MANAGERS,
  SHOW_MANAGER,
  START_MANAGER_RUN,
  STEER_RUN,
  UPDATE_MANAGER
} from "./tokens.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { CreateManagerDto, ManagerMessageDto, UpdateManagerDto } from "./dto/manager.dto.js";

@Controller("api/managers")
export class ManagerController {
  constructor(
    @Inject(DATABASE) private readonly database: NodraSqliteDatabase,
    @Inject(CREATE_MANAGER) private readonly createManager: CreateManager,
    @Inject(UPDATE_MANAGER) private readonly updateManager: UpdateManager,
    @Inject(ARCHIVE_MANAGER) private readonly archiveManager: ArchiveManager,
    @Inject(LIST_MANAGERS) private readonly listManagers: ListManagers,
    @Inject(SHOW_MANAGER) private readonly showManager: ShowManager,
    @Inject(LIST_MANAGER_CONVERSATIONS) private readonly listConversations: ListManagerConversations,
    @Inject(START_MANAGER_RUN) private readonly startRun: StartManagerRun,
    @Inject(STEER_RUN) private readonly steerRun: SteerRun,
    @Inject(DISPATCH_WORKFLOW_OUTBOX) private readonly dispatchOutbox: DispatchWorkflowOutbox
  ) {}

  @Get()
  list() {
    return this.listManagers.execute();
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: CreateManagerDto) {
    return this.createManager.execute({
      id: toId(randomUUID()),
      name: body.name,
      instruction: body.instruction,
      context: commandContext(body.commandId),
      ...(body.providerId ? { providerId: body.providerId } : {}),
      ...(body.modelId ? { modelId: body.modelId } : {}),
      ...(body.reasoningEffort ? { reasoningEffort: body.reasoningEffort as never } : {}),
      ...(body.permissionPreset ? { permissionPreset: body.permissionPreset as never } : {}),
      ...(body.workspaceId ? { workspaceId: toId(body.workspaceId) } : {})
    });
  }

  @Get(":id")
  async show(@Param("id") id: string) {
    const manager = await this.showManager.execute(toId(id));
    if (!manager) throw new DomainError(`Manager ${id} was not found`, "MANAGER_NOT_FOUND");
    return manager;
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: UpdateManagerDto) {
    const config: Partial<ManagerConfig> = {};
    if (body.providerId !== undefined) config.providerId = body.providerId;
    if (body.modelId !== undefined) config.modelId = body.modelId;
    if (body.reasoningEffort !== undefined) config.reasoningEffort = body.reasoningEffort;
    if (body.permissionPreset !== undefined) config.permissionPreset = body.permissionPreset as ManagerConfig["permissionPreset"];
    if (body.workspaceId !== undefined) config.workspaceId = toId(body.workspaceId);
    return this.updateManager.execute({
      id: toId(id),
      context: commandContext(body.commandId),
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.instruction === undefined ? {} : { instruction: body.instruction }),
      ...(Object.keys(config).length ? { config } : {})
    });
  }

  @Delete(":id")
  archive(@Param("id") id: string) {
    return this.archiveManager.execute({ id: toId(id), context: commandContext() });
  }

  @Get(":id/conversations")
  conversations(@Param("id") id: string) {
    return this.listConversations.execute(toId(id));
  }

  @Post(":id/messages")
  async message(@Param("id") id: string, @Body() body: ManagerMessageDto) {
    const manager = await this.showManager.execute(toId(id));
    if (!manager) throw new DomainError(`Manager ${id} was not found`, "MANAGER_NOT_FOUND");
    const context = commandContext(body.commandId);
    const text = body.message.trim();

    if (manager.activeRunId) {
      await this.steerRun.execute(toId(manager.activeRunId), text);
      const active = this.database.orm.select({ conversationId: runs.conversationId }).from(runs).where(eq(runs.id, manager.activeRunId)).get();
      return { runId: manager.activeRunId, threadId: active?.conversationId ?? manager.currentThreadId, steered: true };
    }

    const reuseThread = !body.newConversation && (body.threadId ?? manager.currentThreadId);
    const conversationId = reuseThread ? toId(reuseThread) : toId(randomUUID());
    const result = await this.startRun.execute({
      managerId: toId(id),
      runId: toId(randomUUID()),
      conversationId,
      auditId: toId(`audit/${context.commandId}`),
      outboxId: toId(`outbox/${context.commandId}`),
      message: text,
      newConversation: !reuseThread,
      context
    });
    await this.dispatchOutbox.execute({ limit: 20, occurredAt: new Date().toISOString() });
    return { runId: result.runId, threadId: conversationId, steered: false };
  }

  @Get(":id/threads/:threadId")
  async thread(@Param("id") id: string, @Param("threadId") threadId: string) {
    const conversation = this.database.orm.select().from(conversations)
      .where(eq(conversations.id, threadId)).get();
    if (!conversation || conversation.managerId !== id) {
      throw new DomainError(`Thread ${threadId} was not found`, "CONVERSATION_NOT_FOUND");
    }
    const threadRuns = this.database.orm.select().from(runs)
      .where(eq(runs.conversationId, threadId)).orderBy(asc(runs.createdAt)).all();
    const latest = threadRuns[threadRuns.length - 1] ?? null;
    const items = this.database.orm.select().from(conversationItems)
      .where(eq(conversationItems.conversationId, threadId)).orderBy(conversationItems.ordinal).all();
    const runIds = threadRuns.map((run) => run.id);
    const events = runIds.length
      ? this.database.orm.select().from(providerEvents)
          .where(inArray(providerEvents.runId, runIds)).orderBy(providerEvents.sequence).all()
          .map((event) => ({ ...event, payload: JSON.parse(event.payloadJson) as unknown }))
      : [];
    const config = latest
      ? this.database.orm.select({
          promptEffective: runConfigSnapshots.promptEffective,
          promptManagerInstruction: runConfigSnapshots.promptManagerInstruction,
          cwd: runConfigSnapshots.cwd,
          permissionPreset: runConfigSnapshots.permissionPreset
        }).from(runConfigSnapshots).where(eq(runConfigSnapshots.runId, latest.id)).get()
      : null;
    const manager = await this.showManager.execute(toId(id));
    return { manager, conversation, run: latest, config, items, events, threadId };
  }

  @Get(":id/threads")
  latestThread(@Param("id") id: string) {
    const conversation = this.database.orm.select({ id: conversations.id }).from(conversations)
      .where(eq(conversations.managerId, id)).orderBy(desc(conversations.createdAt)).limit(1).get();
    return { threadId: conversation?.id ?? null };
  }
}
