import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import type { SqliteRunExecutor } from "@nodra/adapters";
import { SQLITE_RUN_EXECUTOR } from "./tokens.js";

@Injectable()
export class RuntimeLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(@Inject(SQLITE_RUN_EXECUTOR) private readonly executor: SqliteRunExecutor) {}

  onApplicationBootstrap(): void { this.executor.start(); }
  onApplicationShutdown(): void { this.executor.stop(); }
}
