import { randomUUID } from "node:crypto";
import { asc, desc, eq, inArray } from "drizzle-orm";
import type { NodraSqliteDatabase } from "@nodra/adapters";
import { conversationItems, conversations } from "@nodra/adapters";
import {
  DomainError,
  toId,
  type ArchiveManager,
  type CommandContext,
  type CreateManager,
  type DispatchWorkflowOutbox,
  type ListManagerConversations,
  type ListManagers,
  type ShowManager,
  type StartManagerRun,
  type UpdateManager
} from "@nodra/application";
import type { I4CliHandler, I4CliRequest } from "./i4-cli.js";

const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "provider_default"];
const PERMISSIONS = ["read_only", "workspace", "full_access"];

export class ManagerCli implements I4CliHandler {
  constructor(
    private readonly createManager: CreateManager,
    private readonly updateManager: UpdateManager,
    private readonly archiveManager: ArchiveManager,
    private readonly listManagers: ListManagers,
    private readonly showManager: ShowManager,
    private readonly listConversations: ListManagerConversations,
    private readonly startRun: StartManagerRun,
    private readonly dispatch: DispatchWorkflowOutbox,
    private readonly database: NodraSqliteDatabase
  ) {}

  async execute(request: I4CliRequest): Promise<unknown | undefined> {
    const { command, context } = request;
    if (!command.startsWith("manager:")) return undefined;
    const values = [...request.args];
    switch (command) {
      case "manager:create":
        return this.create(values, context);
      case "manager:config":
        return this.config(values, context);
      case "manager:archive":
        return this.archive(values, context);
      case "manager:list":
        return this.listManagers.execute({ includeArchived: this.flag(values, "--all") });
      case "manager:show":
        return this.requireOne(values, "manager:show <id>", (id) => this.showManager.execute(toId(id)));
      case "manager:conversations":
        return this.requireOne(values, "manager:conversations <id>", (id) => this.listConversations.execute(toId(id)));
      case "manager:message":
        return this.message(values, context);
      case "manager:messages":
        return this.messages(values);
      default:
        throw new DomainError(`Unknown manager command ${command}`, "CLI_USAGE_ERROR");
    }
  }

  private async create(values: string[], context: CommandContext) {
    const instruction = this.option(values, "--instruction");
    const providerId = this.option(values, "--provider");
    const modelId = this.option(values, "--model");
    const reasoningEffort = this.option(values, "--effort");
    const permissionPreset = this.option(values, "--permission");
    const workspaceId = this.option(values, "--workspace");
    const [name] = values;
    if (!name || values.length !== 1 || !instruction) {
      throw new DomainError(
        "Usage: manager:create \"<name>\" --instruction \"<text>\" [--provider <p> --model <m> --effort <e> --permission <preset> --workspace <id>]",
        "CLI_USAGE_ERROR"
      );
    }
    if (reasoningEffort && !EFFORTS.includes(reasoningEffort)) throw new DomainError("Invalid --effort", "CLI_USAGE_ERROR");
    if (permissionPreset && !PERMISSIONS.includes(permissionPreset)) throw new DomainError("Invalid --permission", "CLI_USAGE_ERROR");
    return this.createManager.execute({
      id: toId(randomUUID()),
      name,
      instruction,
      ...(providerId ? { providerId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(reasoningEffort ? { reasoningEffort: reasoningEffort as never } : {}),
      ...(permissionPreset ? { permissionPreset: permissionPreset as never } : {}),
      ...(workspaceId ? { workspaceId: toId(workspaceId) } : {}),
      context
    });
  }

  private async config(values: string[], context: CommandContext) {
    const name = this.option(values, "--name");
    const instruction = this.option(values, "--instruction");
    const providerId = this.option(values, "--provider");
    const modelId = this.option(values, "--model");
    const reasoningEffort = this.option(values, "--effort");
    const permissionPreset = this.option(values, "--permission");
    const workspaceId = this.option(values, "--workspace");
    const [id] = values;
    if (!id || values.length !== 1) throw new DomainError("Usage: manager:config <id> [--name] [--instruction] [--provider] [--model] [--effort] [--permission] [--workspace]", "CLI_USAGE_ERROR");
    const config: Record<string, unknown> = {};
    if (providerId) config.providerId = providerId;
    if (modelId) config.modelId = modelId;
    if (reasoningEffort) config.reasoningEffort = reasoningEffort;
    if (permissionPreset) config.permissionPreset = permissionPreset;
    if (workspaceId) config.workspaceId = toId(workspaceId);
    return this.updateManager.execute({
      id: toId(id),
      ...(name === undefined ? {} : { name }),
      ...(instruction === undefined ? {} : { instruction }),
      ...(Object.keys(config).length ? { config } : {}),
      context
    });
  }

  private async archive(values: string[], context: CommandContext) {
    const [id] = values;
    if (!id || values.length !== 1) throw new DomainError("Usage: manager:archive <id>", "CLI_USAGE_ERROR");
    return this.archiveManager.execute({ id: toId(id), context });
  }

  private async message(values: string[], context: CommandContext) {
    const startNew = this.flag(values, "--new");
    const [id, message] = values;
    if (!id || !message || values.length !== 2) {
      throw new DomainError("Usage: manager:message <id> \"<text>\" [--new]", "CLI_USAGE_ERROR");
    }
    const manager = await this.showManager.execute(toId(id));
    if (!manager) throw new DomainError(`Manager ${id} was not found`, "MANAGER_NOT_FOUND");
    const reuse = !startNew && manager.currentThreadId;
    const conversationId = reuse ? toId(manager.currentThreadId!) : toId(randomUUID());
    const result = await this.startRun.execute({
      managerId: toId(id),
      runId: toId(randomUUID()),
      conversationId,
      auditId: toId(`audit/${randomUUID()}`),
      outboxId: toId(`outbox/${randomUUID()}`),
      message,
      newConversation: !reuse,
      context
    });
    const dispatched = await this.dispatch.execute({ limit: 10, occurredAt: new Date().toISOString() });
    return { ...result, threadId: conversationId, dispatched: dispatched.accepted };
  }

  private async messages(values: string[]) {
    const role = this.option(values, "--role") ?? "all";
    const lastOnly = this.flag(values, "--last");
    const [id] = values;
    if (!id || values.length !== 1) {
      throw new DomainError("Usage: manager:messages <id> [--role assistant|user|tool|all] [--last]", "CLI_USAGE_ERROR");
    }
    const conversationRows = this.database.orm
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.managerId, toId(id)))
      .orderBy(desc(conversations.createdAt))
      .all();
    const conversationIds = conversationRows.map((row) => row.id);
    const messages = conversationIds.length
      ? this.database.orm
          .select({
            conversationId: conversationItems.conversationId,
            ordinal: conversationItems.ordinal,
            kind: conversationItems.kind,
            body: conversationItems.body,
            createdAt: conversationItems.createdAt
          })
          .from(conversationItems)
          .where(inArray(conversationItems.conversationId, conversationIds))
          .orderBy(asc(conversationItems.createdAt), asc(conversationItems.ordinal))
          .all()
          .filter((item) => (role === "all" ? true : item.kind === role) && item.body?.trim())
      : [];
    const selected = lastOnly ? messages.slice(-1) : messages;
    return { managerId: id, role, count: selected.length, messages: selected };
  }

  private async requireOne(values: string[], usage: string, run: (id: string) => Promise<unknown>) {
    const [id] = values;
    if (!id || values.length !== 1) throw new DomainError(`Usage: ${usage}`, "CLI_USAGE_ERROR");
    return run(id);
  }

  private option(values: string[], flag: string): string | undefined {
    const index = values.indexOf(flag);
    if (index < 0) return undefined;
    const value = values[index + 1];
    if (value === undefined) throw new DomainError(`${flag} requires a value`, "CLI_USAGE_ERROR");
    values.splice(index, 2);
    return value;
  }

  private flag(values: string[], flag: string): boolean {
    const index = values.indexOf(flag);
    if (index < 0) return false;
    values.splice(index, 1);
    return true;
  }
}
