import { DomainError } from "./domain-error.js";
import type { Id } from "./id.js";

export type MissionState =
  | "DRAFT"
  | "READY"
  | "ACTIVE"
  | "BLOCKED"
  | "VALIDATION"
  | "DONE"
  | "ABANDONED";

export type ExecutionKind = "human" | "agent";

export interface MissionSnapshot {
  id: Id;
  projectId: Id | null;
  title: string;
  executionKind: ExecutionKind;
  state: MissionState;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export class Mission {
  private constructor(private snapshotValue: MissionSnapshot) {}

  static create(input: {
    id: Id;
    title: string;
    executionKind: ExecutionKind;
    projectId?: Id | null;
    now: string;
  }): Mission {
    const title = input.title.trim();
    if (!title) throw new DomainError("A mission title is required", "MISSION_TITLE_REQUIRED");
    return new Mission({
      id: input.id,
      projectId: input.projectId ?? null,
      title,
      executionKind: input.executionKind,
      state: "DRAFT",
      version: 0,
      createdAt: input.now,
      updatedAt: input.now
    });
  }

  static rehydrate(snapshot: MissionSnapshot): Mission {
    return new Mission(structuredClone(snapshot));
  }

  markReady(now: string): void {
    if (this.snapshotValue.state !== "DRAFT" && this.snapshotValue.state !== "BLOCKED") {
      throw new DomainError("Only a draft or blocked mission can become ready", "TRANSITION_FORBIDDEN");
    }
    this.snapshotValue.state = "READY";
    this.snapshotValue.version += 1;
    this.snapshotValue.updatedAt = now;
  }

  snapshot(): MissionSnapshot {
    return structuredClone(this.snapshotValue);
  }
}
