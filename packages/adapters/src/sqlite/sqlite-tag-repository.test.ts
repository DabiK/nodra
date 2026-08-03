import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CreateMission, ChangeMissionState, CreateTag, DeleteTag, ListMissionTags, ListTags, SetMissionTags, UpdateTag } from "@nodra/application";
import { asId } from "@nodra/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrate-database.js";
import { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { SqliteMissionReadModel } from "./sqlite-mission-read-model.js";
import { SqliteMissionRepository } from "./sqlite-mission-repository.js";
import { SqliteTagRepository } from "./sqlite-tag-repository.js";
import { missionTags, tags } from "./schema/tags.js";
import { businessAuditEvents } from "./schema/operations.js";

const at = (minute: number) => `2026-07-22T12:${String(minute).padStart(2, "0")}:00.000Z`;
const context = (commandId: string, minute: number) => ({
  commandId: asId(commandId),
  actor: "user" as const,
  occurredAt: at(minute)
});

describe("SQLite tags vertical slice (issue #23)", () => {
  let database: NodraSqliteDatabase;
  let repository: SqliteTagRepository;
  let readModel: SqliteMissionReadModel;
  let createTag: CreateTag;
  let updateTag: UpdateTag;
  let deleteTag: DeleteTag;
  let listTags: ListTags;
  let listMissionTags: ListMissionTags;
  let setMissionTags: SetMissionTags;

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-sqlite-"));
    database = NodraSqliteDatabase.open(join(directory, "nodra.db"));
    await migrateDatabase(database, resolve("packages/adapters/drizzle"));
    repository = new SqliteTagRepository(database);
    readModel = new SqliteMissionReadModel(database);
    createTag = new CreateTag(repository);
    updateTag = new UpdateTag(repository);
    deleteTag = new DeleteTag(repository);
    listTags = new ListTags(repository);
    listMissionTags = new ListMissionTags(repository, readModel);
    setMissionTags = new SetMissionTags(repository, readModel);
  });

  afterEach(() => database.close());

  const createMission = async (id: string, title: string, minute: number) => {
    await new CreateMission(new SqliteMissionRepository(database)).execute({
      id: asId(id),
      title,
      context: context(`command-create-${id}`, minute)
    });
  };

  it("creates tags with normalized label/color and lists them sorted by label", async () => {
    const urgent = await createTag.execute({ id: asId("tag-urgent"), label: "  Urgent ", color: "#FF0000", context: context("c1", 0) });
    const wip = await createTag.execute({ id: asId("tag-wip"), label: "WIP", color: "#00FF00", context: context("c2", 1) });

    expect(urgent).toMatchObject({ label: "Urgent", color: "#ff0000" });
    expect(wip).toMatchObject({ label: "WIP", color: "#00ff00" });
    expect(await listTags.execute()).toEqual([
      expect.objectContaining({ label: "Urgent" }),
      expect.objectContaining({ label: "WIP" })
    ]);
    expect(database.connection.prepare("select count(*) as count from tag").get()).toEqual({ count: 2 });
    expect(database.connection.prepare("select count(*) as count from business_audit_event").get()).toEqual({ count: 2 });
  });

  it("rejects empty labels and invalid colors", async () => {
    await expect(createTag.execute({ id: asId("tag-x"), label: "   ", color: "#FF0000", context: context("c1", 0) }))
      .rejects.toMatchObject({ code: "TAG_LABEL_REQUIRED" });
    await expect(createTag.execute({ id: asId("tag-x"), label: "Ok", color: "red", context: context("c2", 0) }))
      .rejects.toMatchObject({ code: "TAG_COLOR_INVALID" });
    await expect(createTag.execute({ id: asId("tag-x"), label: "Ok", color: "#12345", context: context("c3", 0) }))
      .rejects.toMatchObject({ code: "TAG_COLOR_INVALID" });
  });

  it("rejects duplicate labels (use case check + DB unique index)", async () => {
    await createTag.execute({ id: asId("tag-dup"), label: "Urgent", color: "#FF0000", context: context("c1", 0) });
    await expect(createTag.execute({ id: asId("tag-dup-2"), label: "Urgent", color: "#0000FF", context: context("c2", 1) }))
      .rejects.toMatchObject({ code: "TAG_ALREADY_EXISTS" });

    // Violation directe sur l'index unique (pas de pré-check) → même code d'erreur.
    await expect(
      repository.create({ id: asId("tag-dup-3"), label: "Urgent", color: "#0000FF", context: context("c3", 2) })
    ).rejects.toMatchObject({ code: "TAG_ALREADY_EXISTS" });
  });

  it("renames and recolors a tag, keeping its own label, refusing to steal another label", async () => {
    await createTag.execute({ id: asId("tag-a"), label: "Alpha", color: "#FF0000", context: context("c1", 0) });
    await createTag.execute({ id: asId("tag-b"), label: "Beta", color: "#00FF00", context: context("c2", 1) });

    const updated = await updateTag.execute({ id: asId("tag-a"), label: "Alpha", color: "#123456", context: context("c3", 2) });
    expect(updated).toMatchObject({ id: "tag-a", label: "Alpha", color: "#123456" });

    await expect(updateTag.execute({ id: asId("tag-a"), label: "Beta", color: "#000000", context: context("c4", 3) }))
      .rejects.toMatchObject({ code: "TAG_ALREADY_EXISTS" });

    await expect(updateTag.execute({ id: asId("tag-ghost"), label: "Nouveau", color: "#000000", context: context("c5", 4) }))
      .rejects.toMatchObject({ code: "TAG_NOT_FOUND" });
  });

  it("deletes a tag and its mission links; unknown tag is TAG_NOT_FOUND", async () => {
    await createTag.execute({ id: asId("tag-d"), label: "À supprimer", color: "#FF0000", context: context("c1", 0) });
    await createMission("mission-d", "Mission liée", 1);
    await setMissionTags.execute({ missionId: asId("mission-d"), tagIds: [asId("tag-d")], context: context("c2", 2) });

    await deleteTag.execute(asId("tag-d"));

    expect(await listTags.execute()).toEqual([]);
    expect(database.connection.prepare("select count(*) as count from mission_tag").get()).toEqual({ count: 0 });
    expect(await listMissionTags.execute(asId("mission-d"))).toEqual([]);

    await expect(deleteTag.execute(asId("tag-d"))).rejects.toMatchObject({ code: "TAG_NOT_FOUND" });
  });

  it("attaches, replaces and clears mission tags (SetMissionTags)", async () => {
    await createMission("mission-s", "Mission", 0);
    await createTag.execute({ id: asId("tag-1"), label: "Un", color: "#111111", context: context("c1", 1) });
    await createTag.execute({ id: asId("tag-2"), label: "Deux", color: "#222222", context: context("c2", 2) });
    await createTag.execute({ id: asId("tag-3"), label: "Trois", color: "#333333", context: context("c3", 3) });

    await setMissionTags.execute({ missionId: asId("mission-s"), tagIds: [asId("tag-3"), asId("tag-1")], context: context("c4", 4) });
    expect(await listMissionTags.execute(asId("mission-s"))).toEqual([
      expect.objectContaining({ label: "Trois" }),
      expect.objectContaining({ label: "Un" })
    ]);

    // Remplacement : retirer tag-1.
    await setMissionTags.execute({ missionId: asId("mission-s"), tagIds: [asId("tag-3")], context: context("c5", 5) });
    expect((await listMissionTags.execute(asId("mission-s"))).map((tag) => tag.label)).toEqual(["Trois"]);

    // Vider tous les tags.
    await setMissionTags.execute({ missionId: asId("mission-s"), tagIds: [], context: context("c6", 6) });
    expect(await listMissionTags.execute(asId("mission-s"))).toEqual([]);
    expect(database.connection.prepare("select count(*) as count from mission_tag").get()).toEqual({ count: 0 });
  });

  it("rejects unknown missions and unknown tags on set", async () => {
    await createTag.execute({ id: asId("tag-1"), label: "Un", color: "#111111", context: context("c1", 0) });
    await expect(setMissionTags.execute({ missionId: asId("mission-ghost"), tagIds: [asId("tag-1")], context: context("c2", 1) }))
      .rejects.toMatchObject({ code: "MISSION_NOT_FOUND" });
    await createMission("mission-t", "Mission", 2);
    await expect(setMissionTags.execute({ missionId: asId("mission-t"), tagIds: [asId("tag-ghost")], context: context("c3", 3) }))
      .rejects.toMatchObject({ code: "TAG_NOT_FOUND" });
    await expect(listMissionTags.execute(asId("mission-ghost"))).rejects.toMatchObject({ code: "MISSION_NOT_FOUND" });
  });

  it("exposes tagIds in the mission read model (list, show, relay), sorted by label", async () => {
    await createMission("mission-r1", "Première", 0);
    await createMission("mission-r2", "Deuxième", 1);
    await createTag.execute({ id: asId("tag-z"), label: "Zulu", color: "#111111", context: context("c1", 2) });
    await createTag.execute({ id: asId("tag-a"), label: "Alpha", color: "#222222", context: context("c2", 3) });
    await setMissionTags.execute({ missionId: asId("mission-r1"), tagIds: [asId("tag-z"), asId("tag-a")], context: context("c3", 4) });
    await setMissionTags.execute({ missionId: asId("mission-r2"), tagIds: [asId("tag-z")], context: context("c4", 5) });

    const readList = await readModel.list();
    expect(readList.find((mission) => mission.id === "mission-r1")?.tagIds).toEqual(["tag-a", "tag-z"]);
    expect(readList.find((mission) => mission.id === "mission-r2")?.tagIds).toEqual(["tag-z"]);

    expect((await readModel.show(asId("mission-r1")))?.tagIds).toEqual(["tag-a", "tag-z"]);
    expect((await readModel.show(asId("mission-r2")))?.tagIds).toEqual(["tag-z"]);

    // Relay : promouvoir la mission en READY pour matérialiser un item relay.
    await new ChangeMissionState(new SqliteMissionRepository(database)).execute({
      missionId: asId("mission-r1"), expectedVersion: 0, action: { type: "prepare" }, context: context("c5", 6)
    });
    const relay = await readModel.relay();
    expect(relay.ready.find((mission) => mission.id === "mission-r1")?.tagIds).toEqual(["tag-a", "tag-z"]);

    // Aucun tag → liste vide.
    await createMission("mission-r3", "Sans tag", 7);
    expect((await readModel.show(asId("mission-r3")))?.tagIds).toEqual([]);
  });

  it("writes audit events for tag CRUD (aggregate tag) and mission link (aggregate mission)", async () => {
    await createMission("mission-a", "Mission", 0);
    await createTag.execute({ id: asId("tag-1"), label: "Un", color: "#111111", context: context("c1", 1) });
    await updateTag.execute({ id: asId("tag-1"), label: "Un modifié", color: "#222222", context: context("c2", 2) });
    await setMissionTags.execute({ missionId: asId("mission-a"), tagIds: [asId("tag-1")], context: context("c3", 3) });
    await deleteTag.execute(asId("tag-1"));

    const events = database.orm.select().from(businessAuditEvents).all();
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["MISSION_CREATED", "TAG_CREATED", "TAG_UPDATED", "MISSION_TAGS_UPDATED", "TAG_DELETED"])
    );
    const link = events.find((event) => event.eventType === "MISSION_TAGS_UPDATED");
    expect(link).toMatchObject({ aggregateKind: "mission", aggregateId: "mission-a", actor: "user" });
    expect(JSON.parse(link?.payloadJson ?? "{}")).toEqual({ tagIds: ["tag-1"] });
    const created = events.find((event) => event.eventType === "TAG_CREATED");
    expect(created).toMatchObject({ aggregateKind: "tag", aggregateId: "tag-1" });
  });

  it("cleans up mission_tag rows when the tag is deleted", async () => {
    await createMission("mission-c", "Mission", 0);
    await createTag.execute({ id: asId("tag-c"), label: "Clean", color: "#111111", context: context("c1", 1) });
    await setMissionTags.execute({ missionId: asId("mission-c"), tagIds: [asId("tag-c")], context: context("c2", 2) });
    expect(database.orm.select().from(missionTags).all()).toHaveLength(1);

    await repository.delete(asId("tag-c"));
    expect(database.orm.select().from(missionTags).all()).toHaveLength(0);
    expect(database.orm.select().from(tags).all()).toHaveLength(0);
  });
});
