import type { CommandObservation, CommandObservationPort, GitObservationPort } from "@nodra/application";
import { DomainError } from "@nodra/application";
import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

export class LocalCommandObservationAdapter implements CommandObservationPort {
  constructor(private readonly git: GitObservationPort) {}

  async collect(input: Parameters<CommandObservationPort["collect"]>[0]): Promise<CommandObservation> {
    const cwd = await realpath(input.cwd).catch(() => { throw new DomainError("Command cwd does not exist", "CWD_INVALID"); });
    const workspace = await realpath(input.workspaceRoot).catch(() => { throw new DomainError("Workspace does not exist", "WORKSPACE_INVALID"); });
    const rel = relative(workspace, cwd);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new DomainError("Command cwd escapes run workspace", "CWD_ESCAPE");
    const gitBefore = await this.git.observe(cwd, workspace).catch((error: unknown) => {
      if (error instanceof DomainError && error.code === "GIT_UNAVAILABLE") return null;
      throw error;
    });
    const startedAt = new Date().toISOString();
    const result = await this.spawnBounded(input.argv, cwd, input.timeoutMs, input.maxOutputBytes);
    const endedAt = new Date().toISOString();
    const gitAfter = await this.git.observe(cwd, workspace).catch((error: unknown) => {
      if (error instanceof DomainError && error.code === "GIT_UNAVAILABLE") return null;
      throw error;
    });
    return {
      schemaVersion: 1,
      collectorId: "nodra.command",
      collectorVersion: "1",
      argv: [...input.argv],
      cwd,
      workspaceRoot: workspace,
      environment: { PATH: "[REDACTED]", LANG: "[REDACTED]" },
      startedAt,
      endedAt,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      outputTruncated: result.outputTruncated,
      gitBefore,
      gitAfter,
      stdout: result.stdout,
      stderr: result.stderr
    };
  }

  private spawnBounded(argv: readonly string[], cwd: string, timeoutMs: number, maxOutputBytes: number): Promise<{ exitCode: number|null; signal: string|null; timedOut: boolean; outputTruncated: boolean; stdout: Uint8Array; stderr: Uint8Array }> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(argv[0]!, argv.slice(1), { cwd, shell: false, env: { PATH: process.env.PATH ?? "", LANG: "C" }, stdio: ["ignore", "pipe", "pipe"], detached: false });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let truncated = false;
      let timedOut = false;
      const append = (chunks: Buffer[], chunk: Buffer, current: number) => {
        const remaining = Math.max(0, maxOutputBytes - current);
        if (chunk.length > remaining) truncated = true;
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        return current + Math.min(chunk.length, remaining);
      };
      child.stdout.on("data", (chunk: Buffer) => { stdoutBytes = append(stdout, chunk, stdoutBytes); });
      child.stderr.on("data", (chunk: Buffer) => { stderrBytes = append(stderr, chunk, stderrBytes); });
      child.once("error", () => reject(new DomainError("Command process could not be started", "COMMAND_START_FAILED")));
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); killTimer = setTimeout(() => child.kill("SIGKILL"), 100); }, timeoutMs);
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        resolvePromise({ exitCode: code, signal, timedOut, outputTruncated: truncated, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
      });
    });
  }
}
