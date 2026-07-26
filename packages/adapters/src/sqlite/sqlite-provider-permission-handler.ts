import type {
  ManageConfirmations,
  ProviderPermissionRequest
} from "@nodra/application";
import {
  canonicalTarget,
  targetDigest
} from "@nodra/application";
import { asId } from "@nodra/domain";
import { createHash } from "node:crypto";
import type { SqliteProviderRunStore } from "./sqlite-provider-run-store.js";

export class SqliteProviderPermissionHandler {
  constructor(
    private readonly confirmations: ManageConfirmations,
    private readonly runs: SqliteProviderRunStore,
    private readonly pollIntervalMs = 250
  ) {}

  async handle(runId: string, request: ProviderPermissionRequest): Promise<unknown> {
    const configuration = this.runs.loadConfiguration(runId);
    const stableTarget = JSON.parse(canonicalTarget(request.target)) as Record<string, unknown>;
    const suffix = createHash("sha256")
      .update(`${runId}:${String(request.requestId)}:${targetDigest(stableTarget)}`)
      .digest("hex")
      .slice(0, 24);
    const confirmationId = asId(`provider-confirmation/${suffix}`);
    const createdAt = new Date().toISOString();
    await this.runs.persistEvent(runId, {
      type: "provider/permissionRequested",
      payload: {
        confirmationId,
        action: request.action,
        target: stableTarget,
        risk: request.risk
      },
      occurredAt: createdAt
    });
    await this.confirmations.request({
      id: confirmationId,
      action: request.action,
      target: stableTarget,
      cwd: request.cwd,
      providerId: configuration.providerId,
      permissionPreset: configuration.permissionPreset,
      risk: request.risk,
      scope: "run",
      runId: asId(runId),
      expiresAt: new Date(Date.parse(createdAt) + 30 * 60_000).toISOString(),
      context: {
        commandId: asId(`provider-confirmation-request/${suffix}`),
        actor: "manager",
        occurredAt: createdAt
      }
    });
    await this.runs.markWaiting(runId);
    while (true) {
      const current = await this.confirmations.show(confirmationId);
      if (current.state === "approved") {
        const consumedAt = new Date().toISOString();
        await this.confirmations.consume({
          id: confirmationId,
          action: request.action,
          target: stableTarget,
          cwd: current.cwd,
          scope: "run",
          runId: asId(runId),
          context: {
            commandId: asId(`provider-confirmation-consume/${suffix}`),
            actor: "manager",
            occurredAt: consumedAt
          }
        });
        await this.runs.markRunning(runId);
        return this.approvedResponse(request);
      }
      if (["denied", "expired", "consumed"].includes(current.state)) {
        await this.runs.markRunning(runId);
        return this.deniedResponse(request);
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  private requestedPermissions(providerRequest: unknown): Record<string, unknown> {
    if (typeof providerRequest !== "object" || providerRequest === null) return {};
    const params = (providerRequest as Record<string, unknown>).params;
    if (typeof params !== "object" || params === null) return {};
    const permissions = (params as Record<string, unknown>).permissions;
    return typeof permissions === "object" && permissions !== null
      ? permissions as Record<string, unknown>
      : {};
  }

  private approvedResponse(request: ProviderPermissionRequest): unknown {
    if (request.action === "item/permissions/requestApproval") {
      return { scope: "turn", permissions: this.requestedPermissions(request.providerRequest) };
    }
    return { decision: "accept" };
  }

  private deniedResponse(request: ProviderPermissionRequest): unknown {
    if (request.action === "item/permissions/requestApproval") {
      return { scope: "turn", permissions: {} };
    }
    return { decision: "decline" };
  }
}
