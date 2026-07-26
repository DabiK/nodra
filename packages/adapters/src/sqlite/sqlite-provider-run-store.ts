import type {
  ProviderEventInput,
  ProviderRunConfiguration
} from "@nodra/application";
import { asId, DomainError } from "@nodra/domain";
import { and, eq, max } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { conversationItems, conversations } from "./schema/conversations.js";
import { providerEvents } from "./schema/provider-events.js";
import { runConfigSnapshots, runs } from "./schema/runs.js";

export class SqliteProviderRunStore {
  constructor(private readonly database: NodraSqliteDatabase) {}

  loadConfiguration(runId: string): ProviderRunConfiguration {
    const row = this.database.orm.select({
      runId: runs.id,
      providerId: runs.providerId,
      modelId: runs.modelId,
      reasoningEffort: runs.reasoningEffort,
      prompt: runConfigSnapshots.promptEffective,
      cwd: runConfigSnapshots.cwd,
      permissionPreset: runConfigSnapshots.permissionPreset,
      externalSessionId: conversations.providerSessionRef,
      capabilitiesJson: runConfigSnapshots.providerCapabilitiesJson
    }).from(runs)
      .innerJoin(runConfigSnapshots, eq(runConfigSnapshots.runId, runs.id))
      .innerJoin(conversations, eq(conversations.id, runs.conversationId))
      .where(eq(runs.id, runId))
      .get();
    if (!row) throw new DomainError(`Run ${runId} was not found`, "RUN_NOT_FOUND");
    const effort = row.reasoningEffort ?? "provider_default";
    if (!["minimal", "low", "medium", "high", "xhigh", "provider_default"].includes(effort)) {
      throw new DomainError(`Unsupported reasoning effort ${effort}`, "CONFIG_RESOLUTION_FAILED");
    }
    const capabilities = JSON.parse(row.capabilitiesJson) as {
      version?: unknown;
      contract?: { status?: unknown };
    };
    if (
      typeof capabilities.version !== "string"
      || !["certified", "compatible_unverified", "incompatible"].includes(
        String(capabilities.contract?.status)
      )
    ) {
      throw new DomainError("Provider capability version is missing from the run snapshot", "CONFIG_RESOLUTION_FAILED");
    }
    return {
      runId: asId(row.runId),
      providerId: row.providerId,
      modelId: row.modelId,
      reasoningEffort: effort as ProviderRunConfiguration["reasoningEffort"],
      prompt: row.prompt,
      cwd: row.cwd,
      permissionPreset: row.permissionPreset,
      capabilityVersion: capabilities.version,
      contractStatus: capabilities.contract!.status as ProviderRunConfiguration["contractStatus"],
      session: row.externalSessionId ? { externalId: row.externalSessionId } : null
    };
  }

  async persistSession(runId: string, externalId: string): Promise<void> {
    const run = this.database.orm.select({ conversationId: runs.conversationId })
      .from(runs).where(eq(runs.id, runId)).get();
    if (!run) throw new DomainError(`Run ${runId} was not found`, "RUN_NOT_FOUND");
    this.database.orm.update(conversations).set({ providerSessionRef: externalId })
      .where(eq(conversations.id, run.conversationId)).run();
  }

  async persistRunRef(runId: string, externalId: string): Promise<void> {
    this.database.orm.update(runs).set({ providerRunRef: externalId })
      .where(eq(runs.id, runId)).run();
  }

  async persistEvent(runId: string, input: ProviderEventInput): Promise<number> {
    return this.database.orm.transaction((tx) => {
      const current = tx.select({ sequence: max(providerEvents.sequence) })
        .from(providerEvents).where(eq(providerEvents.runId, runId)).get();
      const sequence = (current?.sequence ?? -1) + 1;
      tx.insert(providerEvents).values({
        id: `provider-event/${runId}/${sequence}`,
        runId,
        sequence,
        type: input.type,
        payloadJson: JSON.stringify(input.payload ?? null),
        sourceAt: input.occurredAt,
        receivedAt: new Date().toISOString()
      }).run();
      this.project(tx, runId, input);
      return sequence;
    });
  }

  async markWaiting(runId: string): Promise<void> {
    this.database.orm.update(runs).set({ state: "WAITING_APPROVAL" })
      .where(and(eq(runs.id, runId), eq(runs.state, "RUNNING"))).run();
  }

  async markRunning(runId: string): Promise<void> {
    this.database.orm.update(runs).set({ state: "RUNNING" })
      .where(and(eq(runs.id, runId), eq(runs.state, "WAITING_APPROVAL"))).run();
  }

  private project(tx: NodraSqliteDatabase["orm"], runId: string, input: ProviderEventInput): void {
    const payload = this.record(input.payload);
    if (input.type === "turn/started") {
      tx.update(runs).set({ state: "RUNNING", startedAt: input.occurredAt })
        .where(and(eq(runs.id, runId), eq(runs.state, "STARTING"))).run();
    }
    if (input.type === "thread/tokenUsage/updated") {
      const usage = this.record(payload?.tokenUsage);
      const total = this.record(usage?.total);
      if (total) {
        tx.update(runs).set({
          inputTokens: this.number(total.inputTokens),
          outputTokens: this.number(total.outputTokens),
          cacheReadTokens: this.number(total.cachedInputTokens),
          cacheWriteTokens: this.number(total.cacheWriteInputTokens),
          usageKind: "reported"
        }).where(eq(runs.id, runId)).run();
      }
    }
    if (input.type === "item/completed") {
      const item = this.record(payload?.item);
      if (item?.type === "agentMessage" && typeof item.text === "string") {
        const run = tx.select({ conversationId: runs.conversationId })
          .from(runs).where(eq(runs.id, runId)).get();
        if (!run) return;
        const ordinalRow = tx.select({ ordinal: max(conversationItems.ordinal) })
          .from(conversationItems)
          .where(eq(conversationItems.conversationId, run.conversationId))
          .get();
        tx.insert(conversationItems).values({
          id: `conversation-item/${runId}/${String(item.id ?? (ordinalRow?.ordinal ?? -1) + 1)}`,
          conversationId: run.conversationId,
          ordinal: (ordinalRow?.ordinal ?? -1) + 1,
          kind: "assistant",
          deliveryState: "acknowledged",
          body: item.text,
          providerItemRef: typeof item.id === "string" ? item.id : null,
          createdAt: input.occurredAt,
          acknowledgedAt: input.occurredAt
        }).onConflictDoNothing().run();
      }
    }
  }

  private record(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private number(value: unknown): number | null {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
}
