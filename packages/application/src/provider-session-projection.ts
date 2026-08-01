import type { Id } from "@nodra/domain";
import type {
  ProviderSessionIdentity,
  ProviderSessionLink
} from "./provider-session-model.js";
import type {
  ProviderSessionCursor,
  ProviderSessionSnapshot,
  ProviderSessionSummary,
  ProviderSessionSyncCapabilities
} from "./provider-session-sync-model.js";

export interface ListedProviderSession {
  id: Id;
  summary: ProviderSessionSummary;
  link: ProviderSessionLink | null;
}

export interface ProviderSessionListProjection {
  sessions: ListedProviderSession[];
  nextCursor: ProviderSessionCursor | null;
}

export interface ProviderSessionDetailProjection {
  identity: ProviderSessionIdentity;
  snapshot: ProviderSessionSnapshot;
  link: ProviderSessionLink | null;
  capabilities: ProviderSessionSyncCapabilities;
}
