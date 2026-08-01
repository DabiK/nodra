import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CreateMission } from "@nodra/application";
import { asId } from "@nodra/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrate-database.js";
import { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { SqliteProviderSessionRepository } from "./sqlite-provider-session-repository.js";
import { SqliteMissionRepository } from "./sqlite-mission-repository.js";

const at = (minute: number) => `2026-08-01T10:${String(minute).padStart(2, "0")}:00.000Z`;

describe("SQLite provider session identity and link repository", () => {
  let database: NodraSqliteDatabase;
  let repository: SqliteProviderSessionRepository;
  let createMission: CreateMission;

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-provider-session-"));
    database = NodraSqliteDatabase.open(join(directory, "nodra.db"));
    await migrateDatabase(database, resolve("packages/adapters/drizzle"));
    database.connection.prepare(`
      insert into provider_catalog_snapshot (id, provider_id, catalog_version, adapter_version, binary_version, contract_digest, authenticated, auth_kind, capabilities_json, models_json, probed_at)
      values (?, ?, ?, ?, null, null, 1, null, ?, ?, ?)
    `).run(
      "codex/test", "codex", "test", "fixture",
      JSON.stringify({ optionsSchemaVersion: 1 }),
      JSON.stringify([{ id: "gpt-test", isDefault: true, supportedReasoningEfforts: ["medium"], defaultReasoningEffort: "medium" }]),
      at(0)
    );
    repository = new SqliteProviderSessionRepository(database);
    createMission = new CreateMission(new SqliteMissionRepository(database));
  });

  afterEach(() => database.close());

  it("observes one stable internal identity for the same provider reference", async () => {
    const first = await repository.observe({
      id: asId("provider-session-1"),
      providerId: "codex",
      externalSessionRef: "opaque/thread/one",
      observedAt: at(0)
    });
    const repeated = await repository.observe({
      id: asId("provider-session-2"),
      providerId: "codex",
      externalSessionRef: "opaque/thread/one",
      observedAt: at(1)
    });

    expect(first).toMatchObject({
      id: "provider-session-1",
      providerId: "codex",
      externalSessionRef: "opaque/thread/one",
      ownership: "external_observed",
      firstObservedAt: at(0),
      lastObservedAt: at(0)
    });
    expect(repeated).toEqual({ ...first, lastObservedAt: at(1) });
    expect(await repository.observe({
      id: asId("provider-session-late"),
      providerId: "codex",
      externalSessionRef: "opaque/thread/one",
      observedAt: at(0)
    })).toEqual(repeated);
    expect(await repository.load(asId("provider-session-1"))).toEqual(repeated);
    expect(await repository.load(asId("provider-session-2"))).toBeNull();
  });

  it("attaches multiple provider sessions read-only to one existing mission", async () => {
    await createMission.execute({
      id: asId("mission-existing"),
      title: "Existing mission",
      context: { commandId: asId("create-existing"), actor: "user", occurredAt: at(0) }
    });
    for (const ordinal of [1, 2]) {
      await repository.observe({
        id: asId(`provider-session-${ordinal}`),
        providerId: "codex",
        externalSessionRef: `opaque-${ordinal}`,
        observedAt: at(ordinal)
      });
    }

    const first = await repository.attachToMission({
      providerSessionId: asId("provider-session-1"),
      missionId: asId("mission-existing"),
      commandId: asId("attach-1"),
      actor: "user",
      occurredAt: at(3)
    });
    const second = await repository.attachToMission({
      providerSessionId: asId("provider-session-2"),
      missionId: asId("mission-existing"),
      commandId: asId("attach-2"),
      actor: "user",
      occurredAt: at(4)
    });

    expect(first.link).toMatchObject({
      providerSessionId: "provider-session-1",
      missionId: "mission-existing",
      mode: "read_only",
      detachedAt: null
    });
    expect(second.link).toMatchObject({
      providerSessionId: "provider-session-2",
      missionId: "mission-existing",
      mode: "read_only",
      detachedAt: null
    });
    expect(await repository.listActiveLinksForMission(asId("mission-existing"))).toEqual([
      first.link,
      second.link
    ]);
  });

  it("rejects attaching one provider session to another active mission without partial writes", async () => {
    for (const missionId of ["mission-a", "mission-b"]) {
      await createMission.execute({
        id: asId(missionId),
        title: missionId,
        context: { commandId: asId(`create-${missionId}`), actor: "user", occurredAt: at(0) }
      });
    }
    await repository.observe({
      id: asId("provider-session-conflict"),
      providerId: "codex",
      externalSessionRef: "opaque-conflict",
      observedAt: at(1)
    });
    const attached = await repository.attachToMission({
      providerSessionId: asId("provider-session-conflict"),
      missionId: asId("mission-a"),
      commandId: asId("attach-a"),
      actor: "user",
      occurredAt: at(2)
    });

    await expect(repository.attachToMission({
      providerSessionId: asId("provider-session-conflict"),
      missionId: asId("mission-b"),
      commandId: asId("attach-b"),
      actor: "user",
      occurredAt: at(3)
    })).rejects.toMatchObject({ code: "PROVIDER_SESSION_LINK_CONFLICT" });
    expect(await repository.loadActiveLink(asId("provider-session-conflict"))).toEqual(attached.link);
    expect(database.connection.prepare("select count(*) as count from provider_session_link").get()).toEqual({ count: 1 });
    expect(database.connection.prepare("select count(*) as count from business_audit_event").get()).toEqual({ count: 3 });
    expect(database.connection.prepare("select count(*) as count from outbox").get()).toEqual({ count: 3 });
  });

  it("replays an identical attach command without duplicating link, audit or outbox", async () => {
    await createMission.execute({
      id: asId("mission-replay"),
      title: "Replay",
      context: { commandId: asId("create-replay"), actor: "user", occurredAt: at(0) }
    });
    await repository.observe({
      id: asId("provider-session-replay"),
      providerId: "codex",
      externalSessionRef: "opaque-replay",
      observedAt: at(1)
    });
    const command = {
      providerSessionId: asId("provider-session-replay"),
      missionId: asId("mission-replay"),
      commandId: asId("attach-replay"),
      actor: "user" as const,
      occurredAt: at(2)
    };

    const first = await repository.attachToMission(command);
    const replay = await repository.attachToMission(command);

    expect(replay).toEqual(first);
    expect(database.connection.prepare("select count(*) as count from provider_session_link").get()).toEqual({ count: 1 });
    expect(database.connection.prepare("select count(*) as count from business_audit_event").get()).toEqual({ count: 2 });
    expect(database.connection.prepare("select count(*) as count from outbox").get()).toEqual({ count: 2 });

    database.connection.prepare("update provider_session_link set detached_at = ? where id = ?")
      .run(at(3), first.link.id);
    expect(await repository.attachToMission(command)).toEqual({
      ...first,
      link: { ...first.link, detachedAt: at(3) }
    });
    expect(database.connection.prepare("select count(*) as count from business_audit_event").get()).toEqual({ count: 2 });
    expect(database.connection.prepare("select count(*) as count from outbox").get()).toEqual({ count: 2 });

    await expect(repository.attachToMission({
      ...command,
      missionId: asId("mission-other")
    })).rejects.toMatchObject({ code: "COMMAND_ID_CONFLICT" });
  });

  it("consumes a new no-op attach command without duplicating the link or outbox", async () => {
    await createMission.execute({
      id: asId("mission-noop"),
      title: "No-op",
      context: { commandId: asId("create-noop"), actor: "user", occurredAt: at(0) }
    });
    await repository.observe({
      id: asId("provider-session-noop"),
      providerId: "codex",
      externalSessionRef: "opaque-noop",
      observedAt: at(1)
    });
    const base = {
      providerSessionId: asId("provider-session-noop"),
      missionId: asId("mission-noop"),
      actor: "user" as const
    };
    const first = await repository.attachToMission({
      ...base,
      commandId: asId("attach-noop-first"),
      occurredAt: at(2)
    });
    const secondCommand = {
      ...base,
      commandId: asId("attach-noop-second"),
      occurredAt: at(3)
    };

    expect(await repository.attachToMission(secondCommand)).toEqual(first);
    expect(await repository.attachToMission(secondCommand)).toEqual(first);
    expect(database.connection.prepare("select count(*) as count from provider_session_link").get()).toEqual({ count: 1 });
    expect(database.connection.prepare("select count(*) as count from business_audit_event").get()).toEqual({ count: 3 });
    expect(database.connection.prepare("select count(*) as count from outbox").get()).toEqual({ count: 2 });
  });

  it("creates and attaches one READY agent mission with complete configuration without execution artifacts", async () => {
    const session = await repository.observe({
      id: asId("provider-session-create"),
      providerId: "codex",
      externalSessionRef: "opaque-create",
      observedAt: at(0)
    });

    const result = await repository.createActiveMissionAndAttach({
      providerSessionId: session.id,
      missionId: asId("mission-created-active"),
      title: "Investigate observed session",
      commandId: asId("create-and-attach"),
      actor: "user",
      occurredAt: at(1)
    });

    expect(result).toMatchObject({
      session,
      mission: {
        id: "mission-created-active",
        executionKind: "agent",
        state: "READY",
        version: 1
      },
      link: {
        providerSessionId: "provider-session-create",
        missionId: "mission-created-active",
        mode: "read_only"
      }
    });
    expect(result.config).toMatchObject({ providerId: "codex", modelId: "gpt-test", reasoningEffort: "medium", permissionPreset: "workspace", missionPrompt: "Investigate observed session", autoCommitAuthorized: false, integrationTargetRef: null });
    expect(result.workspace).toMatchObject({ kind: "repo", state: "ready", path: process.cwd() });
    for (const table of ["run", "conversation", "provider_event", "relay_item"] as const) {
      expect(database.connection.prepare(`select count(*) as count from ${table}`).get(), table).toEqual({ count: 0 });
    }
    expect(database.connection.prepare("select count(*) as count from business_audit_event").get()).toEqual({ count: 1 });
    expect(database.connection.prepare("select count(*) as count from outbox").get()).toEqual({ count: 1 });
  });

  it("activates a linked READY agent mission for provider control without execution or canonical message artifacts", async () => {
    const session = await repository.observe({
      id: asId("provider-session-control"), providerId: "codex",
      externalSessionRef: "thread-control", observedAt: at(0)
    });
    const created = await repository.createActiveMissionAndAttach({
      providerSessionId: session.id, missionId: asId("mission-control"), title: "Controlled thread",
      commandId: asId("create-control"), actor: "user", occurredAt: at(1)
    });

    const activated = await repository.activateMissionControl({
      missionId: created.mission.id,
      expectedVersion: created.mission.version,
      commandId: asId("activate-control"), actor: "user", occurredAt: at(2)
    });

    expect(activated).toMatchObject({
      mission: { id: "mission-control", state: "ACTIVE", version: 2 },
      link: { providerSessionId: "provider-session-control", missionId: "mission-control", mode: "control" },
      session: { externalSessionRef: "thread-control" }
    });
    for (const table of ["run", "conversation", "conversation_item", "conversation_queue", "provider_event"] as const) {
      expect(database.connection.prepare(`select count(*) as count from ${table}`).get(), table).toEqual({ count: 0 });
    }
    expect(database.connection.prepare("select count(*) as count from relay_item").get()).toEqual({ count: 0 });
  });

  it("replays create-and-attach exactly and rejects changed command payload", async () => {
    await repository.observe({
      id: asId("provider-session-create-replay"),
      providerId: "codex",
      externalSessionRef: "opaque-create-replay",
      observedAt: at(0)
    });
    const command = {
      providerSessionId: asId("provider-session-create-replay"),
      missionId: asId("mission-create-replay"),
      title: "Stable title",
      projectId: null,
      commandId: asId("create-attach-replay"),
      actor: "user" as const,
      occurredAt: at(1)
    };

    const first = await repository.createActiveMissionAndAttach(command);
    expect(await repository.createActiveMissionAndAttach(command)).toEqual(first);
    expect(database.connection.prepare("select count(*) as count from mission").get()).toEqual({ count: 1 });
    expect(database.connection.prepare("select count(*) as count from provider_session_link").get()).toEqual({ count: 1 });
    expect(database.connection.prepare("select count(*) as count from relay_item").get()).toEqual({ count: 0 });
    expect(database.connection.prepare("select count(*) as count from business_audit_event").get()).toEqual({ count: 1 });
    expect(database.connection.prepare("select count(*) as count from outbox").get()).toEqual({ count: 1 });

    await expect(repository.createActiveMissionAndAttach({ ...command, title: "Changed title" }))
      .rejects.toMatchObject({ code: "COMMAND_ID_CONFLICT" });
    await expect(repository.createActiveMissionAndAttach({ ...command, title: "   " }))
      .rejects.toMatchObject({ code: "COMMAND_ID_CONFLICT" });
  });

  it("rolls back create-and-attach completely when validation or persistence fails", async () => {
    await repository.observe({
      id: asId("provider-session-rollback"),
      providerId: "codex",
      externalSessionRef: "opaque-rollback",
      observedAt: at(0)
    });

    await expect(repository.createActiveMissionAndAttach({
      providerSessionId: asId("provider-session-rollback"),
      missionId: asId("mission-orphan"),
      projectId: asId("missing-project"),
      title: "Must roll back",
      commandId: asId("create-rollback"),
      actor: "user",
      occurredAt: at(1)
    })).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });

    for (const table of ["mission", "provider_session_link", "relay_item", "business_audit_event", "outbox"] as const) {
      expect(database.connection.prepare(`select count(*) as count from ${table}`).get(), table).toEqual({ count: 0 });
    }

    database.connection.prepare(`
      insert into outbox (id, kind, aggregate_id, payload_json, dedupe_key, created_at, published_at)
      values (?, ?, ?, ?, ?, ?, null)
    `).run(
      "outbox/create-persistence-rollback",
      "test.fixture",
      "fixture",
      "{}",
      "fixture/dedupe",
      at(1)
    );
    await expect(repository.createActiveMissionAndAttach({
      providerSessionId: asId("provider-session-rollback"),
      missionId: asId("mission-persistence-orphan"),
      title: "Must also roll back after inserts",
      commandId: asId("create-persistence-rollback"),
      actor: "user",
      occurredAt: at(2)
    })).rejects.toMatchObject({ code: "PERSISTENCE_FAILURE" });

    for (const table of ["mission", "provider_session_link", "relay_item", "business_audit_event"] as const) {
      expect(database.connection.prepare(`select count(*) as count from ${table}`).get(), table).toEqual({ count: 0 });
    }
    expect(database.connection.prepare("select count(*) as count from outbox").get()).toEqual({ count: 1 });
  });
});
