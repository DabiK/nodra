import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Module, type DynamicModule } from "@nestjs/common";
import {
  migrateDatabase,
  NodraSqliteDatabase,
  SqliteHealthProbe
} from "@nodra/adapters";
import { GetHealth } from "@nodra/application";
import { DatabaseLifecycle } from "./database-lifecycle.js";
import { HealthController } from "./health.controller.js";
import { DATABASE, GET_HEALTH } from "./tokens.js";

export interface NodraModuleOptions {
  databaseFile: string;
  migrationsDirectory: string;
}

@Module({})
export class NodraModule {
  static register(options: NodraModuleOptions): DynamicModule {
    return {
      module: NodraModule,
      controllers: [HealthController],
      providers: [
        {
          provide: DATABASE,
          useFactory: async () => {
            await mkdir(dirname(options.databaseFile), { recursive: true });
            const database = NodraSqliteDatabase.open(options.databaseFile);
            try {
              await migrateDatabase(database, options.migrationsDirectory);
              return database;
            } catch (error) {
              database.close();
              throw error;
            }
          }
        },
        {
          provide: GET_HEALTH,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new GetHealth(new SqliteHealthProbe(database))
        },
        DatabaseLifecycle
      ]
    };
  }
}
