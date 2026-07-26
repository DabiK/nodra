import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { ProcessInspector } from "./process-inspector.js";
import { RuntimeError } from "./runtime-errors.js";
import type { RuntimeProcessIdentity } from "./runtime-types.js";

export interface ProcessLaunch {
  executable: string;
  arguments: string[];
  environment: NodeJS.ProcessEnv;
  logFile: string;
}

export class RuntimeProcessManager {
  constructor(
    private readonly repositoryRoot: string,
    private readonly inspector = new ProcessInspector()
  ) {}

  async start(input: ProcessLaunch): Promise<RuntimeProcessIdentity> {
    const launcher = resolve(
      this.repositoryRoot,
      "scripts/runtime/component-launcher.ts"
    );

    const encodedArguments = Buffer.from(
      JSON.stringify(input.arguments)
    ).toString("base64url");

    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        launcher,
        input.logFile,
        input.executable,
        encodedArguments
      ],
      {
        cwd: this.repositoryRoot,
        env: input.environment,
        detached: true,
        stdio: "ignore"
      }
    );

    let spawnObserved = false;
    let spawnError: Error | null = null;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;

    child.once("spawn", () => {
      spawnObserved = true;
    });

    child.once("error", (error) => {
      spawnError = error;
    });

    child.once("exit", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
    });

    // On garde temporairement la référence au child jusqu’à la capture
    // de son identité.
    const identity = await this.waitForIdentity(child.pid);

    if (!identity) {
      const psResult = child.pid
        ? spawnSync(
            "ps",
            [
              "-o",
              "pid=,ppid=,pgid=,state=,lstart=,command=",
              "-p",
              String(child.pid)
            ],
            { encoding: "utf8" }
          )
        : null;

      const spawnErrorMessage =
        spawnError instanceof Error ? spawnError.message : "none";

      throw new RuntimeError(
        [
          `Launcher for ${input.executable} could not be identified`,
          `launcherPid=${child.pid ?? "undefined"}`,
          `spawnObserved=${spawnObserved}`,
          `spawnError=${spawnErrorMessage}`,
          `exitCode=${String(exitCode)}`,
          `exitSignal=${String(exitSignal)}`,
          `psStatus=${String(psResult?.status)}`,
          `psStdout=${JSON.stringify(psResult?.stdout ?? "")}`,
          `psStderr=${JSON.stringify(psResult?.stderr ?? "")}`,
          `executable=${input.executable}`,
          `arguments=${JSON.stringify(input.arguments)}`,
          `logFile=${input.logFile}`
        ].join("\n"),
        "RUNTIME_PROCESS_START_FAILED"
      );
    }

    child.unref();

    return identity;
  }

  async stop(identity: RuntimeProcessIdentity, timeoutMs: number): Promise<"stopped" | "identity_mismatch"> {
    const actual = this.inspector.inspect(identity.pid);
    if (!actual) return "stopped";
    if (!this.inspector.matches(identity)) return "identity_mismatch";
    this.signalGroup(identity, "SIGTERM");
    if (await this.waitForExit(identity, timeoutMs)) return "stopped";
    if (!this.inspector.matches(identity)) return "stopped";
    this.signalGroup(identity, "SIGKILL");
    await this.waitForExit(identity, Math.min(timeoutMs, 2_000));
    return "stopped";
  }

  private signalGroup(identity: RuntimeProcessIdentity, signal: NodeJS.Signals): void {
    if (identity.pid < 1 || identity.pgid < 1) {
      throw new RuntimeError("Refusing to signal an invalid process identity", "RUNTIME_IDENTITY_INVALID");
    }
    process.kill(-identity.pgid, signal);
  }

  private async waitForIdentity(pid: number | undefined): Promise<RuntimeProcessIdentity | null> {
    if (!pid) return null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const identity = this.inspector.inspect(pid);
      if (identity) return identity;
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    return null;
  }

  private async waitForExit(identity: RuntimeProcessIdentity, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.inspector.matches(identity)) return true;
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    return !this.inspector.matches(identity);
  }
}
