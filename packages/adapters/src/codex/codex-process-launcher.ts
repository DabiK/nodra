import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";

export interface CodexProcessLauncher {
  launch(): ChildProcessWithoutNullStreams;
}

export class LocalCodexProcessLauncher implements CodexProcessLauncher {
  launch(): ChildProcessWithoutNullStreams {
    return spawn("codex", ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });
  }
}
