import { DomainError } from "./domain-error.js";

export type Id = string & { readonly __id: unique symbol };

export const asId = (value: string): Id => {
  const normalized = value.trim();
  if (!normalized) throw new DomainError("An identifier cannot be empty");
  return normalized as Id;
};
