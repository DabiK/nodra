import type { Id } from "@nodra/domain";

export interface CommandContext {
  commandId: Id;
  actor: "user" | "manager";
  occurredAt: string;
}
