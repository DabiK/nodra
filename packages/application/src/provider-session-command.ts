import { DomainError, type Id } from "@nodra/domain";

export const requireProviderSessionCommandId = (commandId: Id): void => {
  if (commandId.trim().length === 0) {
    throw new DomainError("A command identifier is required", "COMMAND_ID_REQUIRED");
  }
};
