import { activityInfo, Context } from "@temporalio/activity";
import {
  ProviderProtocolIncompatibleError,
  type ProviderCatalogRepository,
  type ProviderPort
} from "@nodra/application";
import type {
  RunWorkflowActivities,
  RunWorkflowStartedRequest,
  RunWorkflowTerminalRequest
} from "../contracts.js";
import type { SqliteRunWorkflowActivity } from "../../sqlite/sqlite-run-workflow-activity.js";
import type { SqliteProviderPermissionHandler } from "../../sqlite/sqlite-provider-permission-handler.js";
import type { SqliteProviderRunStore } from "../../sqlite/sqlite-provider-run-store.js";

export class TemporalRunActivities implements RunWorkflowActivities {
  constructor(
    private readonly sqlite: SqliteRunWorkflowActivity,
    private readonly provider?: ProviderPort,
    private readonly providerRuns?: SqliteProviderRunStore,
    private readonly permissions?: SqliteProviderPermissionHandler,
    private readonly providerCatalog?: ProviderCatalogRepository
  ) {}

  async recordStarted(input: RunWorkflowStartedRequest) {
    const info = activityInfo();
    if (!info.workflowExecution) throw new Error("Temporal workflow execution context is missing");
    return this.sqlite.recordStarted({
      ...input,
      temporalRunId: info.workflowExecution.runId,
      occurredAt: new Date().toISOString()
    });
  }

  async recordTerminal(input: RunWorkflowTerminalRequest) {
    const info = activityInfo();
    if (!info.workflowExecution) throw new Error("Temporal workflow execution context is missing");
    return this.sqlite.recordTerminal({
      ...input,
      temporalRunId: info.workflowExecution.runId,
      occurredAt: new Date().toISOString()
    });
  }

  async executeProvider(input: { runId: string }): Promise<{
    state: "SUCCEEDED" | "FAILED" | "CANCELLED";
  }> {
    if (!this.provider || !this.providerRuns || !this.permissions) {
      throw new Error("Provider Activity is not configured");
    }
    const configuration = this.providerRuns.loadConfiguration(input.runId);
    if (configuration.providerId !== this.provider.providerId) {
      throw new Error(`Provider ${configuration.providerId} is unavailable in this worker`);
    }
    const cancellation = Context.current().cancelled.catch(async () => {
      try {
        await this.provider?.cancel(input.runId);
      } catch (error) {
        if (error instanceof ProviderProtocolIncompatibleError) {
          await this.recordControlIncompatible(input.runId, error);
        }
        // Cancellation still propagates through Temporal when no turn was active yet.
      }
    });
    const heartbeat = setInterval(() => {
      try {
        Context.current().heartbeat({ runId: input.runId });
      } catch {
        // Context.current().cancelled owns cooperative interruption.
      }
    }, 1_000);
    try {
      try {
        const result = await this.provider.execute(configuration, {
          session: (externalId) => this.providerRuns!.persistSession(input.runId, externalId),
          runRef: (externalId) => this.providerRuns!.persistRunRef(input.runId, externalId),
          event: (event) => this.providerRuns!.persistEvent(input.runId, event).then(() => undefined),
          permission: (request) => this.permissions!.handle(input.runId, request)
        });
        return { state: result.state };
      } catch (error) {
        if (!(error instanceof ProviderProtocolIncompatibleError)) throw error;
        await this.providerCatalog?.markIncompatible({
          providerId: error.providerId,
          currentVersion: error.currentVersion,
          reason: "protocol_incompatible",
          occurredAt: new Date().toISOString()
        });
        return { state: "FAILED" };
      }
    } finally {
      clearInterval(heartbeat);
      void cancellation;
    }
  }

  async steerProvider(input: { runId: string; text: string }): Promise<void> {
    if (!this.provider) throw new Error("Provider Activity is not configured");
    try {
      await this.provider.steer(input.runId, input.text);
    } catch (error) {
      if (error instanceof ProviderProtocolIncompatibleError) {
        await this.recordControlIncompatible(input.runId, error);
      }
      throw error;
    }
  }

  private async recordControlIncompatible(
    runId: string,
    error: ProviderProtocolIncompatibleError
  ): Promise<void> {
    await this.providerRuns?.persistEvent(runId, {
      type: "provider/protocolIncompatible",
      payload: {
        code: "protocol_incompatible",
        reason: "provider_control_response_invalid",
        currentVersion: error.currentVersion
      },
      occurredAt: new Date().toISOString()
    });
    await this.providerCatalog?.markIncompatible({
      providerId: error.providerId,
      currentVersion: error.currentVersion,
      reason: "protocol_incompatible",
      occurredAt: new Date().toISOString()
    });
  }
}
