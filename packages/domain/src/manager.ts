import { DomainError } from "./domain-error.js";
import type { Id } from "./id.js";

export type ManagerState = "draft" | "ready" | "active" | "blocked" | "archived";

export type ManagerPermissionPreset = "read_only" | "workspace" | "full_access";

export interface ManagerProviderOptions {
  schemaVersion: number;
  value: Record<string, unknown>;
}

export interface ManagerConfig {
  providerId: string | null;
  modelId: string | null;
  reasoningEffort: string | null;
  providerOptions: ManagerProviderOptions;
  permissionPreset: ManagerPermissionPreset;
  workspaceId: Id | null;
}

export interface ManagerSnapshot extends ManagerConfig {
  id: Id;
  projectId: Id | null;
  name: string;
  instruction: string;
  state: ManagerState;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

const DEFAULT_OPTIONS: ManagerProviderOptions = { schemaVersion: 1, value: {} };

export class Manager {
  private constructor(private snapshotValue: ManagerSnapshot) {}

  static create(input: {
    id: Id;
    name: string;
    instruction: string;
    projectId?: Id | null;
    providerId?: string | null;
    modelId?: string | null;
    reasoningEffort?: string | null;
    providerOptions?: ManagerProviderOptions;
    permissionPreset?: ManagerPermissionPreset;
    workspaceId?: Id | null;
    now: string;
  }): Manager {
    const name = input.name.trim();
    if (!name) throw new DomainError("A manager name is required", "MANAGER_NAME_REQUIRED");
    const instruction = input.instruction.trim();
    if (!instruction) throw new DomainError("A manager instruction is required", "MANAGER_INSTRUCTION_REQUIRED");
    const configured = Boolean(input.providerId && input.modelId && input.workspaceId);
    return new Manager({
      id: input.id,
      projectId: input.projectId ?? null,
      name,
      instruction,
      state: configured ? "ready" : "draft",
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      providerOptions: input.providerOptions ?? DEFAULT_OPTIONS,
      permissionPreset: input.permissionPreset ?? "full_access",
      workspaceId: input.workspaceId ?? null,
      createdAt: input.now,
      updatedAt: input.now,
      archivedAt: null
    });
  }

  static rehydrate(snapshot: ManagerSnapshot): Manager {
    return new Manager(structuredClone(snapshot));
  }

  rename(name: string, now: string): void {
    this.requireActive("A manager cannot be renamed once archived");
    const next = name.trim();
    if (!next) throw new DomainError("A manager name is required", "MANAGER_NAME_REQUIRED");
    this.snapshotValue.name = next;
    this.touch(now);
  }

  updateInstruction(instruction: string, now: string): void {
    this.requireActive("A manager cannot be reconfigured once archived");
    const next = instruction.trim();
    if (!next) throw new DomainError("A manager instruction is required", "MANAGER_INSTRUCTION_REQUIRED");
    this.snapshotValue.instruction = next;
    this.touch(now);
  }

  reconfigure(config: Partial<ManagerConfig>, now: string): void {
    if (this.snapshotValue.state === "active") {
      throw new DomainError("A manager cannot be reconfigured while running", "TRANSITION_FORBIDDEN");
    }
    this.requireActive("A manager cannot be reconfigured once archived");
    if (config.providerId !== undefined) this.snapshotValue.providerId = config.providerId;
    if (config.modelId !== undefined) this.snapshotValue.modelId = config.modelId;
    if (config.reasoningEffort !== undefined) this.snapshotValue.reasoningEffort = config.reasoningEffort;
    if (config.providerOptions !== undefined) this.snapshotValue.providerOptions = config.providerOptions;
    if (config.permissionPreset !== undefined) this.snapshotValue.permissionPreset = config.permissionPreset;
    if (config.workspaceId !== undefined) this.snapshotValue.workspaceId = config.workspaceId;
    if (
      this.snapshotValue.state === "draft"
      && this.snapshotValue.providerId
      && this.snapshotValue.modelId
      && this.snapshotValue.workspaceId
    ) {
      this.snapshotValue.state = "ready";
    }
    this.touch(now);
  }

  startRun(now: string): void {
    this.transitionFrom(["ready", "blocked"], "active", now);
  }

  completeRun(now: string): void {
    this.transitionFrom(["active"], "ready", now);
  }

  blockRun(now: string): void {
    this.transitionFrom(["active"], "blocked", now);
  }

  archive(now: string): void {
    if (this.snapshotValue.state === "active") {
      throw new DomainError("A running manager cannot be archived", "TRANSITION_FORBIDDEN");
    }
    if (this.snapshotValue.state === "archived") return;
    this.snapshotValue.state = "archived";
    this.snapshotValue.archivedAt = now;
    this.touch(now);
  }

  snapshot(): ManagerSnapshot {
    return structuredClone(this.snapshotValue);
  }

  private requireActive(message: string): void {
    if (this.snapshotValue.state === "archived") {
      throw new DomainError(message, "TRANSITION_FORBIDDEN");
    }
  }

  private touch(now: string): void {
    this.snapshotValue.updatedAt = now;
  }

  private transitionFrom(allowed: readonly ManagerState[], target: ManagerState, now: string): void {
    if (!allowed.includes(this.snapshotValue.state)) {
      throw new DomainError(
        `Manager cannot transition from ${this.snapshotValue.state} to ${target}`,
        "TRANSITION_FORBIDDEN"
      );
    }
    this.snapshotValue.state = target;
    this.touch(now);
  }
}
