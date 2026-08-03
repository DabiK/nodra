import type { ProviderCatalogRepository, ProviderRegistry } from "@nodra/application";
import { ProviderProtocolIncompatibleError } from "@nodra/application";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { NodraSqliteDatabase } from "../sqlite/nodra-sqlite-database.js";
import { runs } from "../sqlite/schema/runs.js";
import { SqliteProviderPermissionHandler } from "../sqlite/sqlite-provider-permission-handler.js";
import { SqliteProviderRunStore } from "../sqlite/sqlite-provider-run-store.js";
import { SqliteRunCommandStore } from "../sqlite/sqlite-run-command-store.js";
import { SqliteRunWorkflowActivity } from "../sqlite/sqlite-run-workflow-activity.js";
import { SqliteWorkflowOutboxStore } from "../sqlite/sqlite-workflow-outbox-store.js";

/** Local durable executor: SQLite is the queue, state machine and recovery source. */
export class SqliteRunExecutor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly active = new Set<string>();

  constructor(
    private readonly database: NodraSqliteDatabase,
    private readonly outbox: SqliteWorkflowOutboxStore,
    private readonly activity: SqliteRunWorkflowActivity,
    private readonly providers: ProviderRegistry,
    private readonly providerRuns: SqliteProviderRunStore,
    private readonly permissions: SqliteProviderPermissionHandler,
    private readonly catalog: ProviderCatalogRepository,
    private readonly commands: SqliteRunCommandStore
  ) {}

  start(): void { if (!this.timer) { void this.poll(); this.timer = setInterval(() => void this.poll(), 250); } }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async poll(): Promise<void> {
    for (const message of await this.outbox.listPendingStarts(50)) {
      await this.outbox.markPublished(message.id, new Date().toISOString());
      void this.execute(message.input);
    }
    const orphaned = this.database.orm.select({ id: runs.id }).from(runs)
      .where(and(inArray(runs.state, ["STARTING", "RUNNING", "WAITING_APPROVAL"]), isNull(runs.temporalRunId))).all();
    for (const run of orphaned) void this.execute({ runId: run.id as never, commandId: run.id as never, schemaVersion: 1 });
  }

  private async execute(input: { runId: string; commandId: string; missionId?: string; managerId?: string; subjectKind?: "mission" | "manager"; schemaVersion: 1; executeProvider?: boolean }): Promise<void> {
    if (this.active.has(input.runId)) return;
    this.active.add(input.runId);
    const run = this.database.orm.select().from(runs).where(eq(runs.id, input.runId)).get();
    if (!run) return;
    const subjectKind = run.managerId ? "manager" : "mission";
    const missionId = run.missionId ?? undefined;
    const managerId = run.managerId ?? undefined;
    const leaseId = `local/${input.runId}`;
    try {
      await this.activity.recordStarted({ missionId: missionId as never, managerId: managerId as never, subjectKind, commandId: input.commandId as never, runId: input.runId as never, messageId: `run/${input.runId}/started`, schemaVersion: 1, temporalRunId: leaseId, occurredAt: new Date().toISOString() });
      const configuration = this.providerRuns.loadConfiguration(input.runId);
      const provider = this.providers.resolve(configuration.providerId);
      const control = setInterval(() => void this.processCommands(input.runId, provider), 100);
      try {
        const result = await provider.execute(configuration, {
          session: (id) => this.providerRuns.persistSession(input.runId, id), runRef: (id) => this.providerRuns.persistRunRef(input.runId, id),
          event: (event) => this.providerRuns.persistEvent(input.runId, event).then(() => undefined), permission: (request) => this.permissions.handle(input.runId, request)
        });
        await this.activity.recordTerminal({ missionId: missionId as never, managerId: managerId as never, subjectKind, commandId: input.commandId as never, runId: input.runId as never, messageId: `run/${input.runId}/terminal`, state: result.state, schemaVersion: 1, temporalRunId: leaseId, occurredAt: new Date().toISOString() });
      } finally { clearInterval(control); }
    } catch (error) {
      if (error instanceof ProviderProtocolIncompatibleError) await this.catalog.markIncompatible({ providerId: error.providerId, currentVersion: error.currentVersion, reason: "protocol_incompatible", occurredAt: new Date().toISOString() });
      await this.activity.recordTerminal({ missionId: missionId as never, managerId: managerId as never, subjectKind, commandId: input.commandId as never, runId: input.runId as never, messageId: `run/${input.runId}/terminal`, state: "FAILED", schemaVersion: 1, temporalRunId: leaseId, occurredAt: new Date().toISOString() }).catch(() => undefined);
    } finally { this.active.delete(input.runId); }
  }

  private async processCommands(runId: string, provider: ReturnType<ProviderRegistry["resolve"]>): Promise<void> {
    for (const entry of this.commands.pending(runId)) {
      if (entry.command.type === "cancel") await provider.cancel(runId);
      if (entry.command.type === "steer") await provider.steer(runId, entry.command.text);
      this.commands.acknowledge(entry.id);
    }
  }
}
