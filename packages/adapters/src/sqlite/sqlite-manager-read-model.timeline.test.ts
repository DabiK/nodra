import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CreateMission, ListManagerTimeline } from "@nodra/application";
import { asId } from "@nodra/domain";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrate-database.js";
import { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { conversationItems, conversations } from "./schema/conversations.js";
import { managerInstructionVersions, managers } from "./schema/managers.js";
import { SqliteManagerReadModel } from "./sqlite-manager-read-model.js";
import { SqliteMissionRepository } from "./sqlite-mission-repository.js";

const at = (day: number, minute: number) => `2026-07-2${day}T12:${String(minute).padStart(2, "0")}:00.000Z`;
const context = (commandId: string, day: number, minute: number) => ({
  commandId: asId(commandId),
  actor: "user" as const,
  occurredAt: at(day, minute)
});

describe("SQLite manager timeline (issue #24)", () => {
  let database: NodraSqliteDatabase;
  let timeline: ListManagerTimeline;

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-sqlite-"));
    database = NodraSqliteDatabase.open(join(directory, "nodra.db"));
    await migrateDatabase(database, resolve("packages/adapters/drizzle"));
    timeline = new ListManagerTimeline(new SqliteManagerReadModel(database));
  });

  afterEach(() => database.close());

  async function seed() {
    // Les managers `ready`/`active` exigent une instruction courante (trigger) :
    // insertion en `draft`, instruction, puis mise à jour d'état.
    database.orm.insert(managers).values([
      { id: "manager-atlas", name: "Atlas", state: "draft", providerId: "opencode", modelId: "codex", createdAt: at(1, 0) },
      { id: "manager-nova", name: "Nova", state: "draft", providerId: "opencode", modelId: "codex", createdAt: at(1, 0) }
    ]).run();
    database.orm.insert(managerInstructionVersions).values([
      { managerId: "manager-atlas", version: 0, instruction: "Pilote Atlas", isCurrent: 1, createdAt: at(1, 0) },
      { managerId: "manager-nova", version: 0, instruction: "Pilote Nova", isCurrent: 1, createdAt: at(1, 0) }
    ]).run();
    database.orm.update(managers).set({ state: "blocked" }).where(eq(managers.id, "manager-atlas")).run();
    database.orm.update(managers).set({ state: "active" }).where(eq(managers.id, "manager-nova")).run();
    const createMission = new CreateMission(new SqliteMissionRepository(database));
    await createMission.execute({
      id: asId("mission/xyz"),
      title: "Mission fil",
      context: context("create-mission", 1, 0)
    });
    database.orm.insert(conversations).values([
      { id: "conversation-a", managerId: "manager-atlas", missionId: null, providerId: "opencode", state: "open", createdAt: at(1, 0) },
      { id: "conversation-b", managerId: "manager-nova", missionId: null, providerId: "opencode", state: "open", createdAt: at(2, 0) },
      { id: "conversation-deleted", managerId: "manager-nova", missionId: null, providerId: "opencode", state: "deleted", createdAt: at(3, 0), deletedAt: at(3, 30) },
      { id: "conversation-mission", missionId: "mission/xyz", managerId: null, providerId: "opencode", state: "open", createdAt: at(1, 0) }
    ]).run();
    database.orm.insert(conversationItems).values([
      { id: "item-1", conversationId: "conversation-a", ordinal: 0, kind: "user", deliveryState: "acknowledged", body: "Vérifie la mission mission/abc", createdAt: at(1, 10) },
      { id: "item-2", conversationId: "conversation-a", ordinal: 1, kind: "assistant", deliveryState: "acknowledged", body: "Mission mission/abc est bloquée", createdAt: at(1, 15) },
      { id: "item-3", conversationId: "conversation-b", ordinal: 0, kind: "user", deliveryState: "acknowledged", body: "Prépare le release 100%_final", createdAt: at(2, 5) },
      { id: "item-4", conversationId: "conversation-b", ordinal: 1, kind: "tool", deliveryState: "acknowledged", body: "mission:start mission/def", createdAt: at(2, 8) },
      { id: "item-5", conversationId: "conversation-deleted", ordinal: 0, kind: "user", deliveryState: "acknowledged", body: "Conversation supprimée", createdAt: at(3, 10) },
      { id: "item-6", conversationId: "conversation-mission", ordinal: 0, kind: "user", deliveryState: "acknowledged", body: "Fil de mission (hors timeline)", createdAt: at(1, 20) }
    ]).run();
  }

  it("returns an empty timeline when no manager messages exist", async () => {
    await expect(timeline.execute()).resolves.toEqual({ items: [], truncated: false });
  });

  it("aggregates manager messages across managers, most recent first", async () => {
    await seed();
    const view = await timeline.execute();
    expect(view.items.map((item) => item.id)).toEqual(["item-4", "item-3", "item-2", "item-1"]);
    expect(view.items[0]).toMatchObject({
      conversationId: "conversation-b",
      managerId: "manager-nova",
      managerName: "Nova",
      managerState: "active",
      kind: "tool",
      body: "mission:start mission/def",
      createdAt: at(2, 8)
    });
    expect(view.items[3]).toMatchObject({
      conversationId: "conversation-a",
      managerId: "manager-atlas",
      managerName: "Atlas",
      kind: "user",
      body: "Vérifie la mission mission/abc"
    });
  });

  it("excludes deleted conversations and mission conversations", async () => {
    await seed();
    const view = await timeline.execute();
    expect(view.items.some((item) => item.id === "item-5")).toBe(false);
    expect(view.items.some((item) => item.id === "item-6")).toBe(false);
  });

  it("filters by manager", async () => {
    await seed();
    const view = await timeline.execute({ managerId: asId("manager-atlas") });
    expect(view.items.map((item) => item.id)).toEqual(["item-2", "item-1"]);
  });

  it("filters by mission id mentioned in the message body", async () => {
    await seed();
    const view = await timeline.execute({ missionId: asId("mission/abc") });
    expect(view.items.map((item) => item.id)).toEqual(["item-2", "item-1"]);
  });

  it("filters by keyword with LIKE escaping", async () => {
    await seed();
    const literal = await timeline.execute({ query: "100%_final" });
    expect(literal.items.map((item) => item.id)).toEqual(["item-3"]);
    const partial = await timeline.execute({ query: "mission/def" });
    expect(partial.items.map((item) => item.id)).toEqual(["item-4"]);
    const none = await timeline.execute({ query: "introuvable" });
    expect(none.items).toEqual([]);
  });

  it("filters by period (since / until)", async () => {
    await seed();
    const view = await timeline.execute({ since: at(1, 12), until: at(2, 6) });
    expect(view.items.map((item) => item.id)).toEqual(["item-3", "item-2"]);
  });

  it("applies the limit and reports truncation", async () => {
    await seed();
    const view = await timeline.execute({ limit: 2 });
    expect(view.items.map((item) => item.id)).toEqual(["item-4", "item-3"]);
    expect(view.truncated).toBe(true);
    const full = await timeline.execute({ limit: 10 });
    expect(full.truncated).toBe(false);
  });
});
