import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { stripAnsi } from "./strip-ansi.js";

const [logFile, executable, encodedArguments] = process.argv.slice(2);
if (!logFile || !executable || !encodedArguments) {
  throw new Error("Component launcher requires log file, executable and encoded arguments");
}
const arguments_ = JSON.parse(Buffer.from(encodedArguments, "base64url").toString("utf8")) as string[];
await mkdir(dirname(logFile), { recursive: true, mode: 0o700 });

const secretValues = Object.entries(process.env)
  .filter(([name, value]) => value && /(?:TOKEN|SECRET|PASSWORD|API_KEY|AUTH)/i.test(name))
  .map(([, value]) => value!)
  .filter((value) => value.length >= 4);

const redact = (value: string): string => {
  let redacted = value.replace(
    /((?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*)[^\s,}"']+/gi,
    "$1[REDACTED]"
  );
  for (const secret of secretValues) redacted = redacted.replaceAll(secret, "[REDACTED]");
  return redacted;
};

const write = async (component: "stdout" | "stderr", chunk: unknown): Promise<void> => {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    component,
    message: stripAnsi(redact(String(chunk)))
  });
  await appendFile(logFile, line + "\n", { encoding: "utf8", mode: 0o600 });
};

const writeLifecycle = async (message: string): Promise<void> => {
  try {
    await write("stderr", `[launcher] ${message}`);
  } catch {
    // Le diagnostic ne doit jamais faire crasher le launcher.
  }
};

await writeLifecycle(
  `starting launcherPid=${process.pid} ` +
  `ppid=${process.ppid} ` +
  `executable=${executable} ` +
  `arguments=${JSON.stringify(arguments_)}`
);

const child = spawn(executable, arguments_, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODRA_RUNTIME_GROUP_LEADER_PID: String(process.pid)
  },
  stdio: ["ignore", "pipe", "pipe"]
});

await writeLifecycle(
  `component created pid=${child.pid ?? "undefined"}`
);

child.stdout.on("data", (chunk) => {
  void write("stdout", chunk).catch((error) => {
    void writeLifecycle(
      `stdout log failure: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  });
});

child.stderr.on("data", (chunk) => {
  void write("stderr", chunk).catch((error) => {
    void writeLifecycle(
      `stderr log failure: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  });
});

const stop = (signal: NodeJS.Signals): void => {
  if (child.exitCode === null) child.kill(signal);
};
process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

const exitCode = await new Promise<number>((resolveExit) => {
  child.once("spawn", () => {
    void writeLifecycle(
      `component spawned pid=${child.pid ?? "undefined"}`
    );
  });

  child.once("error", (error) => {
    void writeLifecycle(
      `component spawn error name=${error.name} message=${error.message}`
    ).finally(() => {
      resolveExit(1);
    });
  });

  child.once("exit", (code, signal) => {
    void writeLifecycle(
      `component exited pid=${child.pid ?? "undefined"} ` +
      `code=${String(code)} signal=${String(signal)}`
    ).finally(() => {
      resolveExit(code ?? (signal ? 1 : 0));
    });
  });
});

await writeLifecycle(`launcher exiting code=${exitCode}`);

process.exitCode = exitCode;
