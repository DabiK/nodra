import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import {
  migrateDatabase,
  NodraSqliteDatabase,
  SqliteHealthProbe,
  SqliteMissionReadModel,
  SqliteMissionRepository
} from "@nodra/adapters";
import { ChangeMissionState, CreateMission, GetHealth, GetRelay, ListMissions, ShowMission } from "@nodra/application";
import { BusinessErrorFilter } from "./business-error.filter.js";
import { DatabaseLifecycle } from "./database-lifecycle.js";
import { HealthController } from "./health.controller.js";
import { MissionController } from "./mission.controller.js";
import { RelayController } from "./relay.controller.js";
import {
  CHANGE_MISSION_STATE,
  CREATE_MISSION,
  DATABASE,
  GET_HEALTH,
  GET_RELAY,
  LIST_MISSIONS,
  SHOW_MISSION
} from "./tokens.js";

export interface NodraModuleOptions {
  databaseFile: string;
  migrationsDirectory: string;
}

@Module({})
export class NodraModule {
  static register(options: NodraModuleOptions): DynamicModule {
    return {
      module: NodraModule,
      controllers: [HealthController, MissionController, RelayController],
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
        {
          provide: CREATE_MISSION,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new CreateMission(new SqliteMissionRepository(database))
        },
        {
          provide: CHANGE_MISSION_STATE,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ChangeMissionState(new SqliteMissionRepository(database))
        },
        {
          provide: LIST_MISSIONS,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ListMissions(new SqliteMissionReadModel(database))
        },
        {
          provide: SHOW_MISSION,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new ShowMission(new SqliteMissionReadModel(database))
        },
        {
          provide: GET_RELAY,
          inject: [DATABASE],
          useFactory: (database: NodraSqliteDatabase) => new GetRelay(new SqliteMissionReadModel(database))
        },
        { provide: APP_FILTER, useClass: BusinessErrorFilter },
        DatabaseLifecycle
      ]
    };
  }
}
