import type { Event, Permission } from "@opencode-ai/sdk";
import type {
  ProviderEventInput,
  ProviderPermissionRequest
} from "@nodra/application";

export interface OpenCodeMappedEvent {
  event: ProviderEventInput;
  permission?: ProviderPermissionRequest;
  idle: boolean;
  failed: boolean;
}

export class OpenCodeEventMapper {
  map(event: Event, sessionId: string, cwd: string): OpenCodeMappedEvent | null {
    if (!this.belongsToSession(event, sessionId)) return null;
    const occurredAt = new Date().toISOString();
    const mapped: OpenCodeMappedEvent = {
      event: {
        type: `opencode/${event.type}`,
        payload: event,
        occurredAt,
        toolActivity: event.type === "message.part.updated" && event.properties.part.type === "tool"
      },
      idle: event.type === "session.idle",
      failed: event.type === "session.error"
    };
    if (
      event.type === "session.status"
      && event.properties.status.type === "busy"
    ) {
      mapped.event = {
        type: "provider/executionStarted",
        payload: event,
        occurredAt
      };
    }
    if (event.type === "permission.updated") {
      mapped.permission = this.permission(event.properties, cwd);
    }
    return mapped;
  }

  private permission(permission: Permission, cwd: string): ProviderPermissionRequest {
    return {
      requestId: permission.id,
      action: `opencode.permission.${permission.type}`,
      target: {
        permissionId: permission.id,
        type: permission.type,
        pattern: permission.pattern ?? null,
        title: permission.title,
        metadata: permission.metadata
      },
      cwd,
      risk: "provider_permission_request",
      providerRequest: permission
    };
  }

  private belongsToSession(event: Event, sessionId: string): boolean {
    if (event.type === "server.connected") return false;
    const properties = event.properties as Record<string, unknown>;
    if (properties.sessionID === sessionId) return true;
    const info = properties.info;
    if (this.isRecord(info) && info.sessionID === sessionId) return true;
    const part = properties.part;
    return this.isRecord(part) && part.sessionID === sessionId;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
