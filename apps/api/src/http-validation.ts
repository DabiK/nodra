import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";

export const objectBody = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("A JSON object body is required", "REQUEST_INVALID");
  return value as Record<string, unknown>;
};
export const assertKeys = (body: Record<string, unknown>, allowed: readonly string[]) => {
  const unexpected = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new DomainError(`Unexpected field(s): ${unexpected.join(", ")}`, "REQUEST_INVALID");
};
export const requiredString = (value: unknown, name: string) => { if (typeof value !== "string" || !value.trim()) throw new DomainError(`${name} must be a non-empty string`, "REQUEST_INVALID"); return value; };
export const integer = (value: unknown, name: string) => { if (!Number.isInteger(value) || Number(value) < 0) throw new DomainError(`${name} must be a non-negative integer`, "REQUEST_INVALID"); return Number(value); };
export const commandContext = (commandId: unknown) => ({ commandId: toId(commandId === undefined ? randomUUID() : requiredString(commandId, "commandId")), actor: "user" as const, occurredAt: new Date().toISOString() });
