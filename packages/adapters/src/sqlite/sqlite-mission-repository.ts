import type { MissionRepository } from "@nodra/application";
import { asId, DomainError, Mission, type Id } from "@nodra/domain";
import { and, eq } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { missions } from "./schema/missions.js";

export class SqliteMissionRepository implements MissionRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async load(id: Id): Promise<Mission | null> {
    const row = this.database.orm.select().from(missions).where(eq(missions.id, id)).get();
    if (!row) return null;
    return Mission.rehydrate({
      id: asId(row.id),
      projectId: row.projectId ? asId(row.projectId) : null,
      title: row.title,
      executionKind: row.executionKind,
      state: row.state,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    });
  }

  async save(mission: Mission, expectedVersion: number): Promise<void> {
    const snapshot = mission.snapshot();
    if (expectedVersion === -1) {
      this.database.orm.insert(missions).values({ ...snapshot, projectId: snapshot.projectId }).run();
      return;
    }
    const result = this.database.orm
      .update(missions)
      .set({
        projectId: snapshot.projectId,
        title: snapshot.title,
        executionKind: snapshot.executionKind,
        state: snapshot.state,
        version: snapshot.version,
        updatedAt: snapshot.updatedAt
      })
      .where(and(eq(missions.id, snapshot.id), eq(missions.version, expectedVersion)))
      .run();
    if (result.changes !== 1) {
      throw new DomainError("Mission version conflict", "MISSION_VERSION_CONFLICT");
    }
  }
}
