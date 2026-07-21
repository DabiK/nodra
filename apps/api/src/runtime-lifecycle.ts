import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { LazyTemporalConnection } from "@nodra/adapters";
import { TEMPORAL_CONNECTION } from "./tokens.js";

@Injectable()
export class RuntimeLifecycle implements OnApplicationShutdown {
  constructor(@Inject(TEMPORAL_CONNECTION) private readonly temporal: LazyTemporalConnection) {}

  async onApplicationShutdown(): Promise<void> {
    await this.temporal.close();
  }
}
