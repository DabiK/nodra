import type { HealthProbe } from "@nodra/application";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";

export class SqliteHealthProbe implements HealthProbe {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async check(): Promise<{ status: "ok" | "error"; detail?: string }> {
    try {
      this.database.connection.prepare("select 1 as healthy").get();
      const foreignKeys = this.database.connection.pragma("foreign_keys", { simple: true });
      if (foreignKeys !== 1) return { status: "error", detail: "foreign_keys pragma is disabled" };
      return { status: "ok" };
    } catch (error) {
      return { status: "error", detail: error instanceof Error ? error.message : String(error) };
    }
  }
}
