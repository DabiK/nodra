import { DomainError } from "@nodra/domain";

export const translateSqliteError = (error: unknown): DomainError => {
  if (error instanceof DomainError) return error;
  const detail = error instanceof Error && error.message.trim()
    ? error.message
    : "The mission store could not complete the operation";
  return new DomainError(detail, "PERSISTENCE_FAILURE");
};
