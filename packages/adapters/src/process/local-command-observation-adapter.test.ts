import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { ReadOnlyGitObservationAdapter } from "../git/read-only-git-observation-adapter.js";
import { LocalCommandObservationAdapter } from "./local-command-observation-adapter.js";

const exec = promisify(execFile);
describe("LocalCommandObservationAdapter", () => {
  it("uses argv without shell expansion, caps output, redacts env and rejects cwd escape", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "nodra-command-")); await exec("git", ["init", workspace]); await writeFile(join(workspace, "tracked"), "one"); await exec("git", ["-C", workspace, "add", "tracked"]); await exec("git", ["-C", workspace, "-c", "user.name=Nodra", "-c", "user.email=nodra@local", "commit", "-m", "seed"]);
    const adapter = new LocalCommandObservationAdapter(new ReadOnlyGitObservationAdapter());
    const marker = join(workspace, "should-not-exist");
    const result = await adapter.collect({ argv: [process.execPath, "-e", "process.stdout.write(process.argv[1])", `;touch ${marker}`], cwd: workspace, workspaceRoot: workspace, timeoutMs: 5_000, maxOutputBytes: 8 });
    expect(Buffer.from(result.stdout).toString()).toBe(";touch /"); expect(result.outputTruncated).toBe(true); expect(result.environment).toEqual({ PATH: "[REDACTED]", LANG: "[REDACTED]" }); await expect(access(marker)).rejects.toBeDefined();
    await expect(adapter.collect({ argv: [process.execPath, "--version"], cwd: tmpdir(), workspaceRoot: workspace, timeoutMs: 1000, maxOutputBytes: 100 })).rejects.toMatchObject({ code: "CWD_ESCAPE" });
  });
  it("records timeout and signal without background execution", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "nodra-timeout-"));
    const adapter = new LocalCommandObservationAdapter(new ReadOnlyGitObservationAdapter());
    const result = await adapter.collect({ argv: [process.execPath, "-e", "setTimeout(()=>{}, 10000)"], cwd: workspace, workspaceRoot: workspace, timeoutMs: 20, maxOutputBytes: 100 });
    expect(result.timedOut).toBe(true); expect(result.exitCode).toBeNull();
  });
});
