import type { RunControlRepository } from "@nodra/application";
import { asId } from "@nodra/domain";
import { eq } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { conversations } from "./schema/conversations.js";
import { missions } from "./schema/missions.js";
import { runConfigSnapshots, runs } from "./schema/runs.js";

export class SqliteRunControlRepository implements RunControlRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async load(runId: Parameters<RunControlRepository["load"]>[0]) {
    const row = this.database.orm.select({
      id: runs.id,
      missionId: runs.missionId,
      state: runs.state,
      temporalParentWorkflowId: missions.temporalParentWorkflowId,
      providerSessionRef: conversations.providerSessionRef,
      capabilitiesJson: runConfigSnapshots.providerCapabilitiesJson
    }).from(runs)
      .innerJoin(missions, eq(missions.id, runs.missionId))
      .innerJoin(conversations, eq(conversations.id, runs.conversationId))
      .innerJoin(runConfigSnapshots, eq(runConfigSnapshots.runId, runs.id))
      .where(eq(runs.id, runId))
      .get();
    if (!row?.missionId || !row.temporalParentWorkflowId) return null;
    const capabilities = JSON.parse(row.capabilitiesJson);
    return {
      id: asId(row.id),
      missionId: asId(row.missionId),
      temporalParentWorkflowId: row.temporalParentWorkflowId,
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
