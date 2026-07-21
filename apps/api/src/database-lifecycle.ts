import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { NodraSqliteDatabase } from "@nodra/adapters";
import { DATABASE } from "./tokens.js";

@Injectable()
export class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: NodraSqliteDatabase) {}

  onApplicationShutdown(): void {
    if (this.database.connection.open) this.database.close();
  }
}
