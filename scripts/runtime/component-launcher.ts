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

const child = spawn(executable, arguments_, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODRA_RUNTIME_GROUP_LEADER_PID: String(process.pid)
  },
  stdio: ["ignore", "pipe", "pipe"]
});
child.stdout.on("data", (chunk) => { void write("stdout", chunk); });
child.stderr.on("data", (chunk) => { void write("stderr", chunk); });

const stop = (signal: NodeJS.Signals): void => {
  if (child.exitCode === null) child.kill(signal);
};
process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

const exitCode = await new Promise<number>((resolveExit, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
});
process.exitCode = exitCode;
