import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrate-database.js";
import { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { SqliteProviderCatalogRepository } from "./sqlite-provider-catalog-repository.js";

describe("SqliteProviderCatalogRepository compatibility", () => {
  const databases: NodraSqliteDatabase[] = [];

  afterEach(() => databases.splice(0).forEach((database) => database.close()));

  it("persists a runtime consumer-contract failure as incompatible health", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-provider-catalog-"));
    const database = NodraSqliteDatabase.open(join(directory, "nodra.db"));
    databases.push(database);
    await migrateDatabase(database, resolve("packages/adapters/drizzle"));
    const repository = new SqliteProviderCatalogRepository(database);
    const available = { available: true, reason: null };
    await repository.save({
      providerId: "codex",
      adapterVersion: "fixture-v1",
      binaryVersion: "codex_cli_rs/0.146.0",
      authenticated: true,
      authKind: "chatgpt",
      health: {
        status: "degraded",
        reason: "codex_binary_version_not_certified",
        actionRequired: "update_required"
      },
      models: [{
        id: "model-1",
        displayName: "Model One",
        description: "",
        hidden: false,
        isDefault: true,
        supportedReasoningEfforts: ["medium"],
        defaultReasoningEffort: "medium"
      }],
      capabilities: {
        schemaVersion: 1,
        providerId: "codex",
        version: "fixture-v1:codex_cli_rs/0.146.0",
        availability: available,
        authentication: available,
        models: available,
        contract: {
          ...available,
          status: "compatible_unverified",
          expectedVersion: "codex_cli_rs/0.145.0",
          currentVersion: "codex_cli_rs/0.146.0",
          action: "warning"
        },
        start: available,
        events: available,
        cancel: available,
        resume: available,
        steer: { ...available, mode: "immediate" },
        usage: { available: false, reason: "not_observed", kind: "none" },
        attachments: { available: false, reason: "not_supported" },
        mcp: { available: false, reason: "not_supported" },
        permissionInterception: available,
        optionsSchemaVersion: 1
      },
      probedAt: "2026-07-26T10:00:00.000Z"
    });

    await repository.markIncompatible({
      providerId: "codex",
      currentVersion: "codex_cli_rs/0.146.0",
      reason: "protocol_incompatible",
      occurredAt: "2026-07-26T10:01:00.000Z"
    });

    const health = await repository.latest("codex");
    expect(health?.capabilities.contract).toMatchObject({
      status: "incompatible",
      reason: "protocol_incompatible",
      expectedVersion: "codex_cli_rs/0.145.0",
      currentVersion: "codex_cli_rs/0.146.0"
    });
    expect(health?.capabilities.start).toEqual({
      available: false,
      reason: "protocol_incompatible"
    });
    expect(health?.health).toEqual({
      status: "degraded",
      reason: "protocol_incompatible",
      actionRequired: "update_required"
    });
  });
});
