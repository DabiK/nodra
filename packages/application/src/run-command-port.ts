import type { Id } from "@nodra/domain";

export type RunCommand =
  | { type: "cancel" }
  | { type: "resume" }
  | { type: "steer"; text: string; mode: "immediate" | "enqueue" };

export interface RunCommandPort {
  enqueue(runId: Id, command: RunCommand): Promise<void>;
}
