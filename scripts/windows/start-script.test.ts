import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const startScript = resolve(process.cwd(), "scripts", "windows", "start.ps1");

describe("native Windows starter", () => {
  it("launches provider binaries from the documented NODRA overrides", async () => {
    const content = await readFile(startScript, "utf8");

    expect(content).toContain('Resolve-NodraBinary "NODRA_TEMPORAL_BINARY" "temporal"');
    expect(content).toContain('Resolve-NodraBinary "NODRA_OPENCODE_BINARY" "opencode"');
    expect(content).toContain('& `"$temporalBinary`" server start-dev');
    expect(content).toContain('& `"$opencodeBinary`" serve');
  });
});
