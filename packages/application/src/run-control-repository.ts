import type { Id } from "@nodra/domain";

export interface ControllableRun {
  id: Id;
  missionId: Id | null;
  managerId: Id | null;
  temporalParentWorkflowId: string;
  state: string;
  providerSessionRef: string | null;
  capabilities: {
    cancel: { available: boolean; reason: string | null };
    resume: { available: boolean; reason: string | null };
    steer: { available: boolean; reason: string | null; mode: string };
  };
}

export interface RunControlRepository {
  load(runId: Id): Promise<ControllableRun | null>;
}
