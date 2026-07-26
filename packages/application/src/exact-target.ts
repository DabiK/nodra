import { createHash } from "node:crypto";

const normalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)])
    );
  }
  return value;
};

export const canonicalTarget = (value: object): string => JSON.stringify(normalize(value));
export const targetDigest = (value: object): string =>
  createHash("sha256").update(canonicalTarget(value)).digest("hex");
