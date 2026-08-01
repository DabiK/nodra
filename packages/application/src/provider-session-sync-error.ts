import type { ProviderSessionSyncErrorDetails } from "./provider-session-sync-model.js";

export class ProviderSessionSyncError extends Error {
  constructor(readonly details: ProviderSessionSyncErrorDetails) {
    super(details.message);
    this.name = "ProviderSessionSyncError";
  }
}
