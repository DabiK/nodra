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
