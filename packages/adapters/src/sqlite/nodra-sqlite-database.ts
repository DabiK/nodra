import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema/index.js";

export type NodraDrizzleDatabase = BetterSQLite3Database<typeof schema>;

export class NodraSqliteDatabase {
  readonly orm: NodraDrizzleDatabase;

  constructor(readonly connection: Database.Database) {
    connection.pragma("foreign_keys = ON");
    connection.pragma("journal_mode = WAL");
    this.orm = drizzle(connection, { schema });
  }

  static open(filePath: string): NodraSqliteDatabase {
    return new NodraSqliteDatabase(new Database(filePath));
  }

  close(): void {
    this.connection.close();
  }
}
