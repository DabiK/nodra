import { readFile } from "node:fs/promises";
import { RuntimeConfig } from "./runtime-config.js";
import { RuntimeDoctor } from "./runtime-doctor.js";
import { RuntimeError } from "./runtime-errors.js";
import { RuntimeReporter } from "./runtime-reporter.js";
import { RuntimeSupervisor } from "./runtime-supervisor.js";

const command = process.argv[2];
const reporter = new RuntimeReporter();

try {
  const config = RuntimeConfig.load();
  const supervisor = new RuntimeSupervisor(config);
  if (command === "start") {
    process.stdout.write(reporter.status(await supervisor.start()) + "\n");
  } else if (command === "stop") {
    process.stdout.write(reporter.status(await supervisor.stop()) + "\n");
  } else if (command === "status") {
    const status = await supervisor.status();
    process.stdout.write(reporter.status(status) + "\n");
    if (status.overall !== "ready" && status.overall !== "stopped") process.exitCode = 1;
  } else if (command === "doctor") {
    const report = await new RuntimeDoctor(config).run(await supervisor.status());
    process.stdout.write(reporter.doctor(report) + "\n");
    if (!report.ready) process.exitCode = 1;
  } else if (command === "logs") {
    const status = await supervisor.status();
    for (const component of status.components) {
      if (!component.logFile) continue;
      const content = await readFile(component.logFile, "utf8").catch(() => "");
      process.stdout.write(content.split("\n").filter(Boolean).slice(-100).join("\n") + "\n");
    }
  } else {
    throw new RuntimeError(
      "Usage: runtime-cli <start|stop|status|doctor|logs>",
      "RUNTIME_USAGE"
    );
  }
} catch (error) {
  const runtimeError = error instanceof RuntimeError
    ? error
    : new RuntimeError(error instanceof Error ? error.message : String(error), "RUNTIME_INTERNAL_ERROR");
  process.stderr.write(`${JSON.stringify({
    code: runtimeError.code,
    detail: runtimeError.message
  }, null, 2)}\n`);
  process.exitCode = 1;
}
