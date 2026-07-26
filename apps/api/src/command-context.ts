import { toId } from "@nodra/application";
import { randomUUID } from "node:crypto";

export const commandContext = (commandId?: string) => ({
  commandId: toId(commandId ?? randomUUID()),
  actor: "user" as const,
  occurredAt: new Date().toISOString()
});
