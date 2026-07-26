import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { RuntimeProcessIdentity } from "./runtime-types.js";

export class ProcessInspector {
  inspect(pid: number): RuntimeProcessIdentity | null {
    if (!Number.isInteger(pid) || pid < 1) return null;
    const result = spawnSync(
      "ps",
      ["-o", "pid=,pgid=,lstart=,command=", "-p", String(pid)],
      { encoding: "utf8" }
    );
    const line = result.stdout.trim();
    if (result.status !== 0 || !line) return null;
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.+)$/.exec(line);
    if (!match) return null;
    const command = match[4]!;
    if (command === "<defunct>") return null;
    return {
      pid: Number(match[1]),
      pgid: Number(match[2]),
      startedAt: match[3]!,
      command,
      signature: this.signature(command)
    };
  }

  matches(expected: RuntimeProcessIdentity): boolean {
    const actual = this.inspect(expected.pid);
    return actual !== null
      && actual.pgid === expected.pgid
      && actual.startedAt === expected.startedAt
      && actual.signature === expected.signature;
  }

  listener(port: number): RuntimeProcessIdentity | null {
    const result = spawnSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8" }
    );
    const pid = Number(result.stdout.trim().split(/\s+/)[0]);
    return this.inspect(pid);
  }

  private signature(command: string): string {
    return createHash("sha256").update(command).digest("hex");
  }
}
