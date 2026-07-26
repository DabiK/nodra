import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CodexSchemaExporter,
  parseOutputDirectory,
  type SchemaCommandRunner
} from "./export-codex-app-server-schema.js";

describe("CodexSchemaExporter", () => {
  it("exports TypeScript and JSON Schema without starting or authenticating a provider session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-codex-schema-"));
    const run = vi.fn<SchemaCommandRunner["run"]>().mockResolvedValue(undefined);

    const result = await new CodexSchemaExporter({ run }).export(directory);

    expect(run.mock.calls).toEqual([
      ["codex", ["app-server", "generate-ts", "--out", result.typescriptDirectory]],
      ["codex", ["app-server", "generate-json-schema", "--out", result.jsonSchemaDirectory]]
    ]);
    expect(run.mock.calls.flat().join(" ")).not.toContain("thread/");
    expect(run.mock.calls.flat().join(" ")).not.toContain("turn/");
  });

  it("uses an ignored default and rejects ambiguous arguments", () => {
    expect(parseOutputDirectory([])).toBe(".artifacts/codex-app-server-schema");
    expect(parseOutputDirectory(["--out", "tmp/contracts"])).toBe("tmp/contracts");
    expect(() => parseOutputDirectory(["tmp/contracts"])).toThrow("Usage:");
  });
});
