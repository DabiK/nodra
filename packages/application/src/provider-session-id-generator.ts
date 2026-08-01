import type { Id } from "@nodra/domain";

export interface ProviderSessionIdGenerator {
  next(): Id;
}
