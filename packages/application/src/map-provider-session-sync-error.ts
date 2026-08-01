import { DomainError } from "@nodra/domain";
import { ProviderSessionSyncError } from "./provider-session-sync-error.js";

const domainFailures = {
  UNAVAILABLE: ["Provider session synchronization is unavailable", "PROVIDER_SESSION_SYNC_UNAVAILABLE"],
  NOT_FOUND: ["The provider session was not found", "PROVIDER_SESSION_NOT_FOUND"],
  INVALID_CURSOR: ["The provider session cursor is incompatible", "PROVIDER_SESSION_PROTOCOL_INCOMPATIBLE"],
  PROTOCOL_INCOMPATIBLE: ["The provider session protocol is incompatible", "PROVIDER_SESSION_PROTOCOL_INCOMPATIBLE"],
  ACCESS_DENIED: ["Access to the provider session was denied", "PROVIDER_SESSION_ACCESS_DENIED"],
  TRANSIENT_FAILURE: ["Provider session synchronization failed temporarily", "PROVIDER_SESSION_SYNC_TRANSIENT"],
  UNKNOWN: ["Provider session synchronization is unavailable", "PROVIDER_SESSION_SYNC_UNAVAILABLE"]
} as const;

export const mapProviderSessionSyncError = (error: unknown): never => {
  if (error instanceof DomainError) throw error;
  if (error instanceof ProviderSessionSyncError) {
    const [message, code] = domainFailures[error.details.code];
    throw new DomainError(message, code);
  }
  throw new DomainError(
    "Provider session synchronization is unavailable",
    "PROVIDER_SESSION_SYNC_UNAVAILABLE"
  );
};

export const executeProviderSessionSync = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    return mapProviderSessionSyncError(error);
  }
};
