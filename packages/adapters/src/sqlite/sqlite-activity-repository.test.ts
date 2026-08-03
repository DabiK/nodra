import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ChangeMissionState, CreateMission, ListActivity, MarkActivityRead } from "@nodra/application";
import { asId } from "@nodra/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrate-database.js";
import { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { relayItems } from "./schema/operations.js";
import { pipelineDefinitions, pipelineRuns, pipelines } from "./schema/pipelines.js";
import { SqliteActivityRepository } from "./sqlite-activity-repository.js";
import { SqliteMissionRepository } from "./sqlite-mission-repository.js";

const at = (minute: number) => `2026-07-22T12:${String(minute).padStart(2, "0")}:00.000Z`;
const context = (commandId: string, minute: number) => ({
  commandId: asId(commandId),
  actor: "user" as const,
  occurredAt: at(minute)
});

describe("SQLite activity hub (relay blocked + decision_required)", () => {
  let database: NodraSqliteDatabase;
  let listActivity: ListActivity;
  let markActivityRead: MarkActivityRead;

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-sqlite-"));
    database = NodraSqliteDatabase.open(join(directory, "nodra.db"));
    await migrateDatabase(database, resolve("packages/adapters/drizzle"));
    const repository = new SqliteActivityRepository(database);
    listActivity = new ListActivity(repository);
    markActivityRead = new MarkActivityRead(repository);
  });

  afterEach(() => database.close());

  it("returns an empty hub when nothing awaits a decision", async () => {
    expect(await listActivity.execute()).toEqual({ items: [], unreadCount: 0 });
  });

  it("lists blocked and decision_required relay items with mission subjects, most recent first", async () => {
    const createMission = new CreateMission(new SqliteMissionRepository(database));
    const changeMissionState = new ChangeMissionState(new SqliteMissionRepository(database));

    await createMission.execute({ id: asId("mission-validation"), title: "Résultat à valider", context: context("create-a", 0) });
    await createMission.execute({ id: asId("mission-blocked"), title: "Mission bloquée", context: context("create-b", 0) });

    // Mission bloquée via la transition métier (relay écrit par le repository mission).
    await changeMissionState.execute({
      missionId: asId("mission-blocked"), expectedVersion: 0, action: { type: "prepare" }, context: context("ready-b", 1)
    });
    await changeMissionState.execute({
      missionId: asId("mission-blocked"), expectedVersion: 1, action: { type: "pickup" }, context: context("pickup-b", 2)
    });
    await changeMissionState.execute({
      missionId: asId("mission-blocked"), expectedVersion: 2, action: { type: "block", reason: "Attente produit" }, context: context("block-b", 6)
    });

    // Mission en VALIDATION : relay écrit directement (le chemin agent exige des preuves de gate).
    database.orm.insert(relayItems).values({
      id: "relay/mission/mission-validation", missionId: "mission-validation", pipelineRunId: null,
      queue: "decision_required", state: "unread", reasonCode: "mission_decision_required",
      createdAt: at(3)
    }).run();

    const activity = await listActivity.execute();

    expect(activity.unreadCount).toBe(2);
    // La plus récente d'abord (mission blocked relayée à la minute 6 > validation minute 3).
    expect(activity.items.map((item) => item.subject.kind)).toEqual(["mission", "mission"]);
    expect(activity.items[0]).toMatchObject({
      queue: "blocked",
      state: "unread",
      reasonCode: "Attente produit",
      subject: { kind: "mission", mission: { id: "mission-blocked", title: "Mission bloquée", state: "BLOCKED" } }
    });
    expect(activity.items[1]).toMatchObject({
      queue: "decision_required",
      state: "unread",
      reasonCode: "mission_decision_required",
      subject: { kind: "mission", mission: { id: "mission-validation", title: "Résultat à valider", state: "DRAFT" } }
    });
  });

  it("includes pipeline-run relay items and excludes resolved ones", async () => {
    database.orm.insert(pipelines).values({ id: "pipeline-1", name: "Release", state: "active", createdAt: at(0) }).run();
    database.orm.insert(pipelineDefinitions).values({ id: "def-1", pipelineId: "pipeline-1", version: 1, definitionState: "published", createdAt: at(0) }).run();
    database.orm.insert(pipelineRuns).values({ id: "run-1", pipelineId: "pipeline-1", definitionId: "def-1", state: "blocked", createdAt: at(1) }).run();
    database.orm.insert(relayItems).values({
      id: "relay/pipeline/run-1", missionId: null, pipelineRunId: "run-1",
      queue: "decision_required", state: "unread", reasonCode: "pipeline_transition_requires_human",
      createdAt: at(2)
    }).run();
    database.orm.insert(relayItems).values({
      id: "relay/pipeline/run-2", missionId: null, pipelineRunId: "run-1",
      queue: "decision_required", state: "resolved", reasonCode: "pipeline_completed",
      createdAt: at(1), resolvedAt: at(3)
    }).run();

    const activity = await listActivity.execute();

    expect(activity.unreadCount).toBe(1);
    expect(activity.items).toHaveLength(1);
    expect(activity.items[0]).toMatchObject({
      relayId: "relay/pipeline/run-1",
      reasonCode: "pipeline_transition_requires_human",
      subject: { kind: "pipeline", pipelineId: "pipeline-1", pipelineName: "Release" }
    });
  });

  it("marks an unread item as read (badge count drops) and keeps read items listed", async () => {
    const createMission = new CreateMission(new SqliteMissionRepository(database));
    await createMission.execute({ id: asId("mission-validation"), title: "À valider", context: context("create", 0) });
    database.orm.insert(relayItems).values({
      id: "relay/mission/mission-validation", missionId: "mission-validation", pipelineRunId: null,
      queue: "decision_required", state: "unread", reasonCode: "mission_decision_required",
      createdAt: at(1)
    }).run();

    const relayId = (await listActivity.execute()).items[0].relayId;

    await markActivityRead.execute({ relayId, readAt: at(10) });

    const after = await listActivity.execute();
    expect(after.unreadCount).toBe(0);
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).toMatchObject({ state: "read", readAt: at(10) });

    const stored = database.connection.prepare("select state, read_at from relay_item where id = ?").get(relayId) as { state: string; read_at: string | null };
    expect(stored).toEqual({ state: "read", read_at: at(10) });
  });

  it("fails to mark an unknown item read (ACTIVITY_ITEM_NOT_FOUND)", async () => {
    await expect(markActivityRead.execute({ relayId: asId("relay/unknown"), readAt: at(10) }))
      .rejects.toMatchObject({ code: "ACTIVITY_ITEM_NOT_FOUND" });
  });

  it("does not overwrite a resolved item when marking read", async () => {
    database.orm.insert(pipelines).values({ id: "pipeline-1", name: "Release", state: "active", createdAt: at(0) }).run();
    database.orm.insert(pipelineDefinitions).values({ id: "def-1", pipelineId: "pipeline-1", version: 1, definitionState: "published", createdAt: at(0) }).run();
    database.orm.insert(pipelineRuns).values({ id: "run-1", pipelineId: "pipeline-1", definitionId: "def-1", state: "blocked", createdAt: at(1) }).run();
    database.orm.insert(relayItems).values({
      id: "relay/pipeline/run-1", missionId: null, pipelineRunId: "run-1",
      queue: "decision_required", state: "resolved", reasonCode: "pipeline_completed",
      createdAt: at(0), resolvedAt: at(1)
    }).run();

    const marked = await new SqliteActivityRepository(database).markRead(asId("relay/pipeline/run-1"), at(5));

    expect(marked).toBe(false);
    const stored = database.connection.prepare("select state from relay_item where id = ?").get("relay/pipeline/run-1") as { state: string };
    expect(stored.state).toBe("resolved");
  });
});
