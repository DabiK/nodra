import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ChangeMissionState, CreateMission, GetRelay, ListMissionAudit, ListMissionRuns, ListMissions, ShowMission } from "@nodra/application";
import { asId } from "@nodra/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrate-database.js";
import { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { projects } from "./schema/core.js";
import { conversations, conversationItems } from "./schema/conversations.js";
import { runs } from "./schema/runs.js";
import { businessAuditEvents } from "./schema/operations.js";
import { SqliteMissionReadModel } from "./sqlite-mission-read-model.js";
import { SqliteMissionRepository } from "./sqlite-mission-repository.js";
import { missions } from "./schema/missions.js";
import { verifyDatabase } from "./verify-database.js";

const at = (minute: number) => `2026-07-22T12:${String(minute).padStart(2, "0")}:00.000Z`;
const context = (commandId: string, minute: number) => ({
  commandId: asId(commandId),
  actor: "user" as const,
  occurredAt: at(minute)
});

describe("SQLite human mission vertical slice", () => {
  let database: NodraSqliteDatabase;
  let createMission: CreateMission;
  let changeMissionState: ChangeMissionState;
  let listMissions: ListMissions;
  let showMission: ShowMission;
  let getRelay: GetRelay;
  let listMissionRuns: ListMissionRuns;
  let listMissionAudit: ListMissionAudit;

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-sqlite-"));
    database = NodraSqliteDatabase.open(join(directory, "nodra.db"));
    await migrateDatabase(database, resolve("packages/adapters/drizzle"));
    const repository = new SqliteMissionRepository(database);
    const readModel = new SqliteMissionReadModel(database);
    createMission = new CreateMission(repository);
    changeMissionState = new ChangeMissionState(repository);
    listMissions = new ListMissions(readModel);
    showMission = new ShowMission(readModel);
    getRelay = new GetRelay(readModel);
    listMissionRuns = new ListMissionRuns(readModel);
    listMissionAudit = new ListMissionAudit(readModel);
  });

  afterEach(() => database.close());

  it("creates title-only human work atomically without agent configuration, session or run", async () => {
    expect(verifyDatabase(database)).toMatchObject({ foreignKeys: true, journalMode: "wal", migrationVersion: 1 });

    const mission = await createMission.execute({
      id: asId("mission-atomic"),
      title: "Persist a human mission",
      context: context("command-create", 0)
    });

    expect(mission).toMatchObject({ executionKind: "human", state: "DRAFT", version: 0, projectId: null });
    expect(database.connection.prepare("select count(*) as count from mission").get()).toEqual({ count: 1 });
    expect(database.connection.prepare("select count(*) as count from business_audit_event").get()).toEqual({ count: 1 });
    expect(database.connection.prepare("select count(*) as count from outbox").get()).toEqual({ count: 1 });
    expect(database.connection.prepare("select count(*) as count from mission_agent_config").get()).toEqual({ count: 0 });
    expect(database.connection.prepare("select count(*) as count from conversation").get()).toEqual({ count: 0 });
    expect(database.connection.prepare("select count(*) as count from run").get()).toEqual({ count: 0 });
  });

  it("materializes each Relay bucket and returns explicit empty buckets", async () => {
    await createMission.execute({ id: asId("mission-flow"), title: "Flow", context: context("create-flow", 0) });
    expect(await getRelay.execute()).toEqual({ ready: [], active: [], blocked: [], decision_required: [] });

    await changeMissionState.execute({
      missionId: asId("mission-flow"), expectedVersion: 0, action: { type: "prepare" }, context: context("ready-flow", 1)
    });
    expect((await getRelay.execute()).ready).toEqual([expect.objectContaining({ id: "mission-flow", state: "READY" })]);

    await changeMissionState.execute({
      missionId: asId("mission-flow"), expectedVersion: 1, action: { type: "pickup" }, context: context("pickup-flow", 2)
    });
    expect((await getRelay.execute()).active).toEqual([expect.objectContaining({ state: "ACTIVE" })]);

    await changeMissionState.execute({
      missionId: asId("mission-flow"),
      expectedVersion: 2,
      action: { type: "block", reason: "Waiting for product decision" },
      context: context("block-flow", 3)
    });
    expect((await getRelay.execute()).blocked).toEqual([
      expect.objectContaining({ state: "BLOCKED", reasonCode: "Waiting for product decision" })
    ]);

    await changeMissionState.execute({
      missionId: asId("mission-flow"), expectedVersion: 3, action: { type: "resume" }, context: context("resume-flow", 4)
    });
    await changeMissionState.execute({
      missionId: asId("mission-flow"), expectedVersion: 4, action: { type: "close" }, context: context("close-flow", 5)
    });
    expect(await getRelay.execute()).toEqual({ ready: [], active: [], blocked: [], decision_required: [] });
    expect(await showMission.execute(asId("mission-flow"))).toMatchObject({ state: "DONE", version: 5 });
    expect(await listMissions.execute()).toEqual([expect.objectContaining({ id: "mission-flow", state: "DONE" })]);
    expect(database.connection.prepare("select count(*) as count from business_audit_event").get()).toEqual({ count: 6 });
    expect(database.connection.prepare("select count(*) as count from outbox").get()).toEqual({ count: 6 });
  });

  it("filters mission and Relay reads by project without mutating history", async () => {
    database.orm.insert(projects).values({ id: "project-a", kind: "scratch", name: "A", createdAt: at(0), updatedAt: at(0) }).run();
    database.orm.insert(projects).values({ id: "project-b", kind: "scratch", name: "B", createdAt: at(0), updatedAt: at(0) }).run();
    await createMission.execute({
      id: asId("mission-a"), projectId: asId("project-a"), title: "A", context: context("create-a", 0)
    });
    await createMission.execute({
      id: asId("mission-b"), projectId: asId("project-b"), title: "B", context: context("create-b", 0)
    });
    await createMission.execute({ id: asId("mission-scratch"), title: "Scratch", context: context("create-scratch", 0) });
    for (const [id, commandId] of [["mission-a", "ready-a"], ["mission-b", "ready-b"], ["mission-scratch", "ready-scratch"]] as const) {
      await changeMissionState.execute({
        missionId: asId(id), expectedVersion: 0, action: { type: "prepare" }, context: context(commandId, 1)
      });
    }

    expect((await listMissions.execute({ projectId: asId("project-a") })).map(({ id }) => id)).toEqual(["mission-a"]);
    expect((await listMissions.execute({ projectId: null })).map(({ id }) => id)).toEqual(["mission-scratch"]);
    expect((await getRelay.execute({ projectId: asId("project-b") })).ready.map(({ id }) => id)).toEqual(["mission-b"]);
    expect(database.connection.prepare("select count(*) as count from business_audit_event").get()).toEqual({ count: 6 });
  });

  it("returns a stable version conflict and persists none of the attempted command", async () => {
    await createMission.execute({ id: asId("mission-conflict"), title: "Conflict", context: context("create-conflict", 0) });
    await changeMissionState.execute({
      missionId: asId("mission-conflict"), expectedVersion: 0, action: { type: "prepare" }, context: context("ready-conflict", 1)
    });

    await expect(changeMissionState.execute({
      missionId: asId("mission-conflict"), expectedVersion: 0, action: { type: "close" }, context: context("ready-conflict", 2)
    })).rejects.toMatchObject({ code: "MISSION_VERSION_CONFLICT" });
    expect(await showMission.execute(asId("mission-conflict"))).toMatchObject({ state: "READY", version: 1 });
    expect(database.connection.prepare("select count(*) as count from business_audit_event").get()).toEqual({ count: 2 });
    expect(database.connection.prepare("select count(*) as count from outbox").get()).toEqual({ count: 2 });
  });

  it("returns a stable command conflict and rolls back mission, Relay, audit and outbox", async () => {
    await createMission.execute({ id: asId("mission-rollback"), title: "Rollback", context: context("shared-command", 0) });

    await expect(changeMissionState.execute({
      missionId: asId("mission-rollback"), expectedVersion: 0, action: { type: "prepare" }, context: context("shared-command", 1)
    })).rejects.toMatchObject({ code: "COMMAND_ID_CONFLICT" });
    expect(await showMission.execute(asId("mission-rollback"))).toMatchObject({ state: "DRAFT", version: 0 });
    expect(await getRelay.execute()).toEqual({ ready: [], active: [], blocked: [], decision_required: [] });
    expect(database.connection.prepare("select count(*) as count from mission").get()).toEqual({ count: 1 });
    expect(database.connection.prepare("select count(*) as count from business_audit_event").get()).toEqual({ count: 1 });
    expect(database.connection.prepare("select count(*) as count from outbox").get()).toEqual({ count: 1 });
  });

  it("rejects a missing project before writing any mission, Relay, audit or outbox row", async () => {
    await expect(createMission.execute({
      id: asId("mission-missing-project"),
      projectId: asId("project-missing"),
      title: "Missing project",
      context: context("missing-project-command", 0)
    })).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });

    for (const table of ["mission", "relay_item", "business_audit_event", "outbox"] as const) {
      expect(database.connection.prepare(`select count(*) as count from ${table}`).get(), table).toEqual({ count: 0 });
    }
  });

  it("rejects a duplicated create command without keeping the second aggregate", async () => {
    await createMission.execute({ id: asId("mission-first"), title: "First", context: context("duplicate-create", 0) });

    await expect(createMission.execute({
      id: asId("mission-second"), title: "Second", context: context("duplicate-create", 1)
    })).rejects.toMatchObject({ code: "COMMAND_ID_CONFLICT" });
    expect((await listMissions.execute()).map(({ id }) => id)).toEqual(["mission-first"]);
    expect(await getRelay.execute()).toEqual({ ready: [], active: [], blocked: [], decision_required: [] });
    expect(database.connection.prepare("select count(*) as count from business_audit_event").get()).toEqual({ count: 1 });
    expect(database.connection.prepare("select count(*) as count from outbox").get()).toEqual({ count: 1 });
  });

  it("submits a finished agent mission to VALIDATION without gate evidence and relays a decision", async () => {
    database.orm.insert(missions).values({
      id: "mission-submit",
      projectId: null,
      title: "Submit me",
      executionKind: "agent",
      state: "ACTIVE",
      version: 4,
      createdAt: at(0),
      updatedAt: at(0)
    }).run();

    const submitted = await changeMissionState.execute({
      missionId: asId("mission-submit"),
      expectedVersion: 4,
      action: { type: "submit", declaredResult: "Le résultat du run est prêt." },
      context: context("submit-command", 1)
    });
    expect(submitted).toMatchObject({ state: "VALIDATION", version: 5 });
    expect(await showMission.execute(asId("mission-submit"))).toMatchObject({ state: "VALIDATION", version: 5 });
    expect((await getRelay.execute()).decision_required).toEqual([
      expect.objectContaining({ id: "mission-submit", state: "VALIDATION", reasonCode: "mission_decision_required" })
    ]);
    const audit = database.connection
      .prepare("select payload_json from business_audit_event where command_id = ?")
      .get("submit-command") as { payload_json: string };
    expect(JSON.parse(audit.payload_json)).toMatchObject({
      action: "submit",
      fromState: "ACTIVE",
      toState: "VALIDATION",
      declaredResult: "Le résultat du run est prêt."
    });
  });

  it("rejects a manual submit without a declared result or outside ACTIVE", async () => {
    database.orm.insert(missions).values({
      id: "mission-submit-strict",
      projectId: null,
      title: "Strict submit",
      executionKind: "agent",
      state: "ACTIVE",
      version: 2,
      createdAt: at(0),
      updatedAt: at(0)
    }).run();

    await expect(changeMissionState.execute({
      missionId: asId("mission-submit-strict"),
      expectedVersion: 2,
      action: { type: "submit", declaredResult: "  " },
      context: context("submit-empty", 1)
    })).rejects.toMatchObject({ code: "VALIDATION_RESULT_REQUIRED" });

    await changeMissionState.execute({
      missionId: asId("mission-submit-strict"),
      expectedVersion: 2,
      action: { type: "submit", declaredResult: "Résultat valide." },
      context: context("submit-valid", 2)
    });
    await expect(changeMissionState.execute({
      missionId: asId("mission-submit-strict"),
      expectedVersion: 3,
      action: { type: "submit", declaredResult: "Encore un résultat." },
      context: context("submit-twice", 3)
    })).rejects.toMatchObject({ code: "TRANSITION_FORBIDDEN" });
    expect(await showMission.execute(asId("mission-submit-strict"))).toMatchObject({ state: "VALIDATION", version: 3 });
  });

  it("lists mission runs with usage and cost, oldest first, and sums known costs", async () => {
    await createMission.execute({ id: asId("mission-runs"), title: "Runs", context: context("create-runs", 0) });
    database.orm.insert(conversations).values({
      id: "conversation-runs",
      missionId: "mission-runs",
      managerId: null,
      providerId: "opencode",
      providerSessionRef: null,
      state: "open",
      createdAt: at(1),
      deletedAt: null
    }).run();
    database.orm.insert(runs).values([
      {
        id: "run-runs-1", missionId: "mission-runs", managerId: null, conversationId: "conversation-runs",
        userAttempt: 1, state: "SUCCEEDED", temporalWorkflowId: "run/run-runs-1", temporalRunId: "temporal-1",
        providerId: "opencode", modelId: "model-a", reasoningEffort: "provider_default",
        startedAt: at(1), endedAt: at(2), durationMs: 60_000,
        inputTokens: 1000, outputTokens: 500, cacheReadTokens: 10, cacheWriteTokens: null,
        costMicros: 12_345, usageKind: "reported", createdAt: at(1)
      },
      {
        id: "run-runs-2", missionId: "mission-runs", managerId: null, conversationId: "conversation-runs",
        userAttempt: 2, state: "RUNNING", temporalWorkflowId: "run/run-runs-2", temporalRunId: "temporal-2",
        providerId: "opencode", modelId: "model-a", reasoningEffort: "provider_default",
        startedAt: at(3), endedAt: null, durationMs: null,
        inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
        costMicros: null, usageKind: null, createdAt: at(3)
      }
    ]).run();

    const history = await listMissionRuns.execute(asId("mission-runs"));
    expect(history.totalCostMicros).toBe(12_345);
    expect(history.runs.map((run) => run.id)).toEqual(["run-runs-1", "run-runs-2"]);
    expect(history.runs[0]).toMatchObject({
      attempt: 1, state: "SUCCEEDED", providerId: "opencode", modelId: "model-a",
      inputTokens: 1000, outputTokens: 500, cacheReadTokens: 10,
      costMicros: 12_345, usageKind: "reported"
    });
    expect(history.runs[1]).toMatchObject({ attempt: 2, state: "RUNNING", costMicros: null });
  });

  it("returns an empty history for a known mission without runs", async () => {
    await createMission.execute({ id: asId("mission-no-runs"), title: "No runs", context: context("create-no-runs", 0) });
    expect(await listMissionRuns.execute(asId("mission-no-runs"))).toEqual({ runs: [], totalCostMicros: null });
  });

  it("exposes the latest run and last assistant message on mission views (live mini-cartes)", async () => {
    await createMission.execute({ id: asId("mission-live"), title: "Live", context: context("create-live", 0) });
    await createMission.execute({ id: asId("mission-done"), title: "Done", context: context("create-done", 0) });
    await createMission.execute({ id: asId("mission-empty"), title: "Empty", context: context("create-empty", 0) });

    for (const [conversationId, missionId, attempt, state, startedAt, endedAt] of [
      ["conversation-live-1", "mission-live", 1, "SUCCEEDED", at(1), at(2)],
      ["conversation-live-2", "mission-live", 2, "RUNNING", at(3), null],
      ["conversation-done-1", "mission-done", 1, "SUCCEEDED", at(1), at(2)]
    ] as const) {
      database.orm.insert(conversations).values({
        id: conversationId,
        missionId,
        managerId: null,
        providerId: "opencode",
        providerSessionRef: null,
        state: "open",
        createdAt: startedAt ?? at(1),
        deletedAt: null
      }).run();
      database.orm.insert(runs).values({
        id: `run-${conversationId}`, missionId, managerId: null, conversationId,
        userAttempt: attempt, state, temporalWorkflowId: `run/${conversationId}`, temporalRunId: null,
        providerId: "opencode", modelId: "model-a", reasoningEffort: "provider_default",
        startedAt, endedAt, durationMs: endedAt ? 60_000 : null,
        inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
        costMicros: null, usageKind: null, createdAt: startedAt ?? at(1)
      }).run();
    }

    // Deux messages assistant dans la conversation du run actif : le plus récent doit gagner.
    database.orm.insert(conversationItems).values([
      {
        id: "item-live-1", conversationId: "conversation-live-1", ordinal: 0, kind: "assistant",
        deliveryState: "sent", body: "Premier essai terminé.", createdAt: at(2)
      },
      {
        id: "item-live-2", conversationId: "conversation-live-2", ordinal: 0, kind: "assistant",
        deliveryState: "sent", body: "Je commence.", createdAt: at(3)
      },
      {
        id: "item-live-3", conversationId: "conversation-live-2", ordinal: 1, kind: "assistant",
        deliveryState: "sent", body: "Je m'en occupe.", createdAt: at(4)
      },
      {
        id: "item-done-1", conversationId: "conversation-done-1", ordinal: 0, kind: "assistant",
        deliveryState: "sent", body: "Terminé.", createdAt: at(2)
      }
    ]).run();

    const views = await listMissions.execute();
    const live = views.find((mission) => mission.id === "mission-live");
    expect(live).toMatchObject({
      runState: "RUNNING",
      runStartedAt: at(3),
      lastAssistantMessage: "Je m'en occupe."
    });
    const done = views.find((mission) => mission.id === "mission-done");
    expect(done).toMatchObject({ runState: "SUCCEEDED", runStartedAt: at(1), lastAssistantMessage: null });
    const empty = views.find((mission) => mission.id === "mission-empty");
    expect(empty).toMatchObject({ runState: null, runStartedAt: null, lastAssistantMessage: null });

    expect(await showMission.execute(asId("mission-live"))).toMatchObject({
      runState: "RUNNING",
      runStartedAt: at(3),
      lastAssistantMessage: "Je m'en occupe."
    });
  });

  it("rejects a run history lookup for an unknown mission", async () => {
    await expect(listMissionRuns.execute(asId("mission-unknown")))
      .rejects.toMatchObject({ code: "MISSION_NOT_FOUND" });
  });

  it("lists the mission audit timeline oldest first with actor and transition payload", async () => {
    await createMission.execute({ id: asId("mission-audit"), title: "Audit", context: context("create-audit", 0) });
    await changeMissionState.execute({
      missionId: asId("mission-audit"),
      expectedVersion: 0,
      action: { type: "prepare" },
      context: { commandId: asId("prepare-audit"), actor: "user", occurredAt: at(5) }
    });
    await changeMissionState.execute({
      missionId: asId("mission-audit"),
      expectedVersion: 1,
      action: { type: "pickup" },
      context: { commandId: asId("pickup-audit"), actor: "user", occurredAt: at(9) }
    });

    const timeline = await listMissionAudit.execute(asId("mission-audit"));
    const [created, prepared, pickedUp] = timeline;
    expect(timeline.map((event) => event.eventType)).toEqual([
      "MISSION_CREATED",
      "MISSION_PREPARED",
      "MISSION_PICKED_UP"
    ]);
    expect(created).toMatchObject({
      id: "audit/create-audit",
      commandId: "create-audit",
      actor: "user",
      payload: { fromState: null, toState: "DRAFT" },
      occurredAt: at(0)
    });
    expect(prepared?.payload).toMatchObject({ fromState: "DRAFT", toState: "READY" });
    expect(pickedUp?.payload).toMatchObject({ fromState: "READY", toState: "ACTIVE" });
  });

  it("returns an empty timeline for a known mission without audit events", async () => {
    // Insertion directe (sans commande d'agrégat) : aucune ligne d'audit n'existe pour cette mission.
    database.orm.insert(missions).values({
      id: "mission-no-audit",
      projectId: null,
      title: "No audit",
      executionKind: "human",
      state: "DRAFT",
      version: 0,
      createdAt: at(0),
      updatedAt: at(0)
    }).run();
    // Un événement d'une autre mission ne doit pas fuiter.
    database.orm.insert(businessAuditEvents).values({
      id: "audit/other",
      aggregateKind: "mission",
      aggregateId: "mission-other",
      commandId: "other",
      eventType: "MISSION_PREPARED",
      actor: "manager",
      payloadJson: JSON.stringify({ schemaVersion: 1 }),
      occurredAt: at(1)
    }).run();
    expect(await listMissionAudit.execute(asId("mission-no-audit"))).toEqual([]);
  });

  it("rejects an audit timeline lookup for an unknown mission", async () => {
    await expect(listMissionAudit.execute(asId("mission-unknown")))
      .rejects.toMatchObject({ code: "MISSION_NOT_FOUND" });
  });
});
