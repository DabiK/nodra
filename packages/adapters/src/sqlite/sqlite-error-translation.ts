import { DomainError } from "@nodra/domain";

export const translateSqliteError = (error: unknown): DomainError => {
  if (error instanceof DomainError) return error;
  return new DomainError("The mission store could not complete the operation", "PERSISTENCE_FAILURE");
};
