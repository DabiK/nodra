import type {
  ProviderHistoryPage,
  ProviderHistoryQuery,
  ProviderSessionEvent,
  ProviderSessionListQuery,
  ProviderSessionPage,
  ProviderSessionRef,
  ProviderSessionSnapshot,
  ProviderSessionSyncCapabilities,
  ProviderSubscription
} from "./provider-session-sync-model.js";

export interface ProviderSessionSyncPort {
  readonly providerId: string;
  capabilities(): Promise<ProviderSessionSyncCapabilities>;
  listSessions(query: ProviderSessionListQuery): Promise<ProviderSessionPage>;
  readSession(ref: ProviderSessionRef): Promise<ProviderSessionSnapshot>;
  readHistory(query: ProviderHistoryQuery): Promise<ProviderHistoryPage>;
  subscribe(input: ProviderSubscription): AsyncIterable<ProviderSessionEvent>;
}
