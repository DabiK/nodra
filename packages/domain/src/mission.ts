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

export interface ValidationSubmission {
  runSucceeded: true;
  declaredResult: string;
  gateEvidenceIds: readonly Id[];
}

export interface HumanAcceptance {
  accepted: true;
  actor: "user";
}

export type AgentBlockReason = "dependency" | "provider" | "budget";

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

  static createHuman(input: { id: Id; title: string; projectId?: Id | null; now: string }): Mission {
    return Mission.create({ ...input, executionKind: "human" });
  }

  static rehydrate(snapshot: MissionSnapshot): Mission {
    return new Mission(structuredClone(snapshot));
  }

  prepare(now: string): void {
    this.transitionFrom(["DRAFT"], "READY", now);
  }

  enableAgent(now: string): void {
    this.requireHuman("Only a human mission can be enabled as an agent mission");
    if (this.snapshotValue.state !== "DRAFT") {
      throw new DomainError("Only a DRAFT mission can be enabled as an agent mission", "TRANSITION_FORBIDDEN");
    }
    this.snapshotValue.executionKind = "agent";
    this.snapshotValue.version += 1;
    this.snapshotValue.updatedAt = now;
  }

  pickup(now: string): void {
    this.requireHuman("Only a human mission can be picked up without an agent run");
    this.transitionFrom(["READY"], "ACTIVE", now);
  }

  startAgent(now: string): void {
    this.requireAgent("Only an agent mission can be started through an agent run");
    this.transitionFrom(["READY"], "ACTIVE", now);
  }

  block(now: string, reason: string): void {
    this.requireHuman("Only a human mission can be blocked without an agent run");
    if (!reason.trim()) throw new DomainError("A blocking reason is required", "BLOCK_REASON_REQUIRED");
    this.transitionFrom(["ACTIVE"], "BLOCKED", now);
  }

  blockAgent(now: string, _reason: AgentBlockReason): void {
    this.requireAgent("Only an agent mission can use an agent blocking reason");
    this.transitionFrom(["ACTIVE"], "BLOCKED", now);
  }

  resume(now: string): void {
    this.transitionFrom(["BLOCKED"], "READY", now);
  }

  close(now: string): void {
    this.requireHuman("Only a human mission can be closed without acceptance evidence");
    this.transitionFrom(["DRAFT", "READY"], "DONE", now);
  }

  abandon(now: string): void {
    this.transitionFrom(["DRAFT", "READY", "BLOCKED"], "ABANDONED", now);
  }

  submitForValidation(now: string, submission: ValidationSubmission): void {
    if (this.snapshotValue.executionKind !== "agent") {
      throw new DomainError("A human mission cannot submit an agent result", "TRANSITION_FORBIDDEN");
    }
    if (!submission.declaredResult.trim() || submission.gateEvidenceIds.length === 0) {
      throw new DomainError(
        "Validation requires a declared result and observed gate evidence",
        "VALIDATION_EVIDENCE_REQUIRED"
      );
    }
    this.transitionFrom(["ACTIVE"], "VALIDATION", now);
  }

  recordAgentSuccess(now: string, declaredResult: string): void {
    this.requireAgent("Only an agent mission can record an agent success");
    if (!declaredResult.trim()) {
      throw new DomainError("An agent success requires a declared result", "VALIDATION_RESULT_REQUIRED");
    }
    this.transitionFrom(["ACTIVE"], "VALIDATION", now);
  }

  accept(now: string, acceptance: HumanAcceptance): void {
    if (this.snapshotValue.executionKind !== "agent") {
      throw new DomainError("A human mission cannot accept an agent result", "TRANSITION_FORBIDDEN");
    }
    if (!acceptance.accepted || acceptance.actor !== "user") {
      throw new DomainError("Human acceptance is required", "HUMAN_ACCEPTANCE_REQUIRED");
    }
    this.transitionFrom(["VALIDATION"], "DONE", now);
  }

  requestCorrection(now: string): void {
    if (this.snapshotValue.executionKind !== "agent") {
      throw new DomainError("A human mission cannot request agent correction", "TRANSITION_FORBIDDEN");
    }
    this.transitionFrom(["VALIDATION"], "READY", now);
  }

  snapshot(): MissionSnapshot {
    return structuredClone(this.snapshotValue);
  }

  private requireHuman(message: string): void {
    if (this.snapshotValue.executionKind !== "human") {
      throw new DomainError(message, "TRANSITION_FORBIDDEN");
    }
  }

  private requireAgent(message: string): void {
    if (this.snapshotValue.executionKind !== "agent") {
      throw new DomainError(message, "TRANSITION_FORBIDDEN");
    }
  }

  private transitionFrom(allowed: readonly MissionState[], target: MissionState, now: string): void {
    if (!allowed.includes(this.snapshotValue.state)) {
      throw new DomainError(
        `Mission cannot transition from ${this.snapshotValue.state} to ${target}`,
        "TRANSITION_FORBIDDEN"
      );
    }
    this.snapshotValue.state = target;
    this.snapshotValue.version += 1;
    this.snapshotValue.updatedAt = now;
  }
}
