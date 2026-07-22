import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : Promise.resolve(entry.name.endsWith(".ts") ? [path] : []);
    })
  );
  return nested.flat();
};

const importedModules = (source: string): string[] =>
  [...source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)].map((match) => match[1] ?? "");

const assertBoundary = async (folder: string, forbidden: RegExp) => {
  const violations: string[] = [];
  for (const file of await sourceFiles(resolve(folder))) {
    const imports = importedModules(await readFile(file, "utf8"));
    for (const imported of imports) if (forbidden.test(imported)) violations.push(`${file}: ${imported}`);
  }
  expect(violations).toEqual([]);
};

describe("architecture boundaries", () => {
  it("keeps domain free of frameworks and I/O adapters", async () => {
    await assertBoundary(
      "packages/domain/src",
      /(?:@nestjs|drizzle|temporal|better-sqlite|@nodra\/(?:application|adapters)|codex|copilot)/i
    );
  });

  it("keeps application independent from Nest, Drizzle, Temporal and providers", async () => {
    await assertBoundary(
      "packages/application/src",
      /(?:@nestjs|drizzle|temporal|better-sqlite|@nodra\/adapters|codex|copilot)/i
    );
  });

  it("keeps inbound controllers and CLI commands dependent on application only", async () => {
    for (const file of [
      "apps/api/src/business-error.filter.ts",
      "apps/api/src/health.controller.ts",
      "apps/api/src/evidence.controller.ts",
      "apps/api/src/gate.controller.ts",
      "apps/api/src/approval.controller.ts",
      "apps/api/src/delivery.controller.ts",
      "apps/api/src/mission.controller.ts",
      "apps/api/src/relay.controller.ts",
      "apps/api/src/runtime.controller.ts",
      "apps/cli/src/nodra-cli.ts",
      "apps/cli/src/i4-cli.ts",
      "apps/cli/src/evidence-cli.ts",
      "apps/cli/src/gate-cli.ts",
      "apps/cli/src/approval-cli.ts",
      "apps/cli/src/delivery-cli.ts"
    ]) {
      const imports = importedModules(await readFile(resolve(file), "utf8"));
      expect(imports.filter((imported) => /@nodra\/(?:domain|adapters)/.test(imported)), file).toEqual([]);
    }
  });

  it("keeps Temporal workflows deterministic and free of adapter I/O", async () => {
    const files = await sourceFiles(resolve("packages/adapters/src/temporal/workflows"));
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      const imports = importedModules(source);
      for (const imported of imports) {
        if (/(?:node:|sqlite|drizzle|better-sqlite|activities|providers|git|process)/i.test(imported)) {
          violations.push(`${file}: ${imported}`);
        }
      }
      if (/\b(?:Date|Math\.random|process|fetch)\b/.test(source)) violations.push(`${file}: nondeterministic global`);
    }
    expect(violations).toEqual([]);
  });

  it("keeps barrel files declarative", async () => {
    for (const file of [
      "packages/domain/src/index.ts",
      "packages/application/src/index.ts",
      "packages/adapters/src/index.ts",
      "packages/adapters/src/sqlite/schema/index.ts"
    ]) {
      const source = await readFile(resolve(file), "utf8");
      expect(source).not.toMatch(/\b(?:class|function|const|let|var)\b/);
    }
  });

  it("keeps at most one class per production file", async () => {
    const files = [
      ...(await sourceFiles(resolve("packages"))),
      ...(await sourceFiles(resolve("apps")))
    ].filter((file) => !file.endsWith(".test.ts"));
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      const classCount = [...source.matchAll(/\bclass\s+[A-Z]\w*/g)].length;
      if (classCount > 1) violations.push(`${file}: ${classCount} classes`);
    }
    expect(violations).toEqual([]);
  });
});
