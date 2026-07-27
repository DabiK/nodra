import type { RunControlRepository } from "@nodra/application";
import { asId } from "@nodra/domain";
import { eq } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { conversations } from "./schema/conversations.js";
import { managers } from "./schema/managers.js";
import { missions } from "./schema/missions.js";
import { runConfigSnapshots, runs } from "./schema/runs.js";

export class SqliteRunControlRepository implements RunControlRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async load(runId: Parameters<RunControlRepository["load"]>[0]) {
    const row = this.database.orm.select({
      id: runs.id,
      missionId: runs.missionId,
      managerId: runs.managerId,
      state: runs.state,
      missionWorkflowId: missions.temporalParentWorkflowId,
      managerWorkflowId: managers.temporalParentWorkflowId,
      providerSessionRef: conversations.providerSessionRef,
      capabilitiesJson: runConfigSnapshots.providerCapabilitiesJson
    }).from(runs)
      .leftJoin(missions, eq(missions.id, runs.missionId))
      .leftJoin(managers, eq(managers.id, runs.managerId))
      .innerJoin(conversations, eq(conversations.id, runs.conversationId))
      .innerJoin(runConfigSnapshots, eq(runConfigSnapshots.runId, runs.id))
      .where(eq(runs.id, runId))
      .get();
    const temporalParentWorkflowId = row?.missionWorkflowId ?? row?.managerWorkflowId ?? null;
    if (!row || !temporalParentWorkflowId) return null;
    const capabilities = JSON.parse(row.capabilitiesJson);
    return {
      id: asId(row.id),
      missionId: row.missionId ? asId(row.missionId) : null,
      managerId: row.managerId ? asId(row.managerId) : null,
      temporalParentWorkflowId,
      state: row.state,
      providerSessionRef: row.providerSessionRef,
      capabilities: {
        cancel: capabilities.cancel,
        resume: capabilities.resume,
        steer: capabilities.steer
      }
    };
  }
}
