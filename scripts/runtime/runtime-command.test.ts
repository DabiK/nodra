import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("runtime npm commands", () => {
  it("exposes the five local runtime commands through the isolated CLI", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts).toMatchObject({
      "runtime:start": "tsx scripts/runtime/runtime-cli.ts start",
      "runtime:stop": "tsx scripts/runtime/runtime-cli.ts stop",
      "runtime:status": "tsx scripts/runtime/runtime-cli.ts status",
      "runtime:doctor": "tsx scripts/runtime/runtime-cli.ts doctor",
      "runtime:logs": "tsx scripts/runtime/runtime-cli.ts logs"
    });
  });
});
