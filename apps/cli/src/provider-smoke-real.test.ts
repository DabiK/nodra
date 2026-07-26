import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CodexProviderAdapter,
  migrateDatabase,
  NodraSqliteDatabase,
  SqliteProviderCatalogRepository
} from "@nodra/adapters";
import { SmokeProvider } from "@nodra/application";
import { describe, expect, it } from "vitest";
import { ProviderSmokeCli } from "./provider-smoke-cli.js";

describe("real Codex provider smoke", () => {
  it.skipIf(process.env.NODRA_TEST_REAL_CODEX_TURN !== "1")(
    "consumes one real gpt-5.4-mini low turn and validates app-server end to end",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "nodra-real-codex-smoke-"));
      const database = NodraSqliteDatabase.open(join(root, "nodra.db"));
      try {
        await migrateDatabase(database, resolve("packages/adapters/drizzle"));
        const catalog = new SqliteProviderCatalogRepository(database);
        const provider = new CodexProviderAdapter();
        await catalog.save(await provider.probe());
        await expect(new ProviderSmokeCli(
          new SmokeProvider(provider, catalog),
          root
        ).execute("provider:smoke", [
          "codex",
          "--allow-turn",
          "--model",
          "gpt-5.4-mini",
          "--effort",
          "low"
        ])).resolves.toMatchObject({
          provider: "codex",
          model: "gpt-5.4-mini",
          effort: "low",
          terminalState: "SUCCEEDED",
          message: "NODRA_SMOKE_OK"
        });
      } finally {
        database.close();
      }
    },
    150_000
  );
});
