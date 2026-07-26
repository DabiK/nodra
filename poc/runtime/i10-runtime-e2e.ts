import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PortAllocator } from "../../scripts/runtime/port-allocator.js";
import { ProcessInspector } from "../../scripts/runtime/process-inspector.js";
import { RuntimeConfig } from "../../scripts/runtime/runtime-config.js";
import { RuntimeDoctor } from "../../scripts/runtime/runtime-doctor.js";
import { RuntimeHealth } from "../../scripts/runtime/runtime-health.js";
import { RuntimeSupervisor } from "../../scripts/runtime/runtime-supervisor.js";

if (process.env.NODRA_TEST_RUNTIME_I10 !== "1") {
  throw new Error("Set NODRA_TEST_RUNTIME_I10=1 to run the real local I10 lifecycle");
}

const invariant: (condition: unknown, detail: string) => asserts condition = (condition, detail) => {
  if (!condition) throw new Error(`I10 runtime invariant failed: ${detail}`);
};

const root = process.cwd();
const dataRoot = await mkdtemp(join(tmpdir(), "nodra-i10-runtime-"));
const ports = new PortAllocator();
const inspector = new ProcessInspector();
const health = new RuntimeHealth();
const temporalPort = await ports.free();
const opencodePort = await ports.free();
const apiPort = await ports.free();
const opencodeBinary = process.env.NODRA_OPENCODE_BINARY ?? "/Users/Dabi/.opencode/bin/opencode";
const externalOpenCode = spawn(opencodeBinary, [
  "serve",
  "--hostname",
  "127.0.0.1",
  "--port",
  String(opencodePort),
  "--pure",
  "--print-logs"
], {
  cwd: root,
  env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  detached: true,
  stdio: "ignore"
});
externalOpenCode.unref();

let supervisor: RuntimeSupervisor | undefined;
let managedIdentities: Array<NonNullable<Awaited<ReturnType<RuntimeSupervisor["status"]>>["components"][number]["identity"]>> = [];
let report: Record<string, unknown> | undefined;

try {
  const externalUrl = `http://127.0.0.1:${opencodePort}`;
  await health.wait(
    async () => {
      const result = await health.opencode(externalUrl);
      return { ready: result.ready, detail: result.detail };
    },
    "external OpenCode Serve"
  );

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODRA_DATA_ROOT: dataRoot,
    NODRA_RUNTIME_ROOT: join(dataRoot, "runtime"),
    NODRA_DATABASE_FILE: join(dataRoot, "nodra.db"),
    NODRA_RUNTIME_PROFILE: "user",
    NODRA_TEMPORAL_ADDRESS: `127.0.0.1:${temporalPort}`,
    NODRA_TEMPORAL_NAMESPACE: "nodra",
    NODRA_OPENCODE_URL: externalUrl,
    NODRA_API_URL: `http://127.0.0.1:${apiPort}`,
    NODRA_RUNTIME_STOP_TIMEOUT_MS: "3000"
  };
  const config = RuntimeConfig.load(environment, root);
  supervisor = new RuntimeSupervisor(config);
  const started = await supervisor.start();
  invariant(started.overall === "ready", "start reports every component ready");
  invariant(
    started.components.find((component) => component.name === "opencode")?.ownership === "external",
    "existing OpenCode is classified external"
  );
  managedIdentities = started.components
    .filter((component) => component.ownership === "managed" && component.identity)
    .map((component) => component.identity!);

  const status = await supervisor.status();
  invariant(status.overall === "ready", "status remains ready");
  const doctor = await new RuntimeDoctor(config).run(status);
  invariant(doctor.ready, "doctor validates binaries, namespace, API, worker and provider snapshot");

  const stopped = await supervisor.stop();
  invariant(stopped.overall === "stopped", "stop removes managed runtime state");
  invariant(await ports.available(temporalPort), "Temporal port is closed");
  invariant(await ports.available(apiPort), "API port is closed");
  invariant((await health.opencode(externalUrl)).ready, "external OpenCode remains alive");
  invariant(
    managedIdentities.every((identity) => !inspector.matches(identity)),
    "no managed process identity remains"
  );
  report = {
    dataRoot,
    profile: config.profile,
    temporal: { pid: started.manifest?.components.temporal.identity?.pid, port: temporalPort },
    opencode: {
      pid: started.manifest?.components.opencode.identity?.pid,
      port: opencodePort,
      ownership: "external",
      survivedStop: true
    },
    api: { pid: started.manifest?.components.api.identity?.pid, port: apiPort },
    worker: { pid: started.manifest?.components.worker.identity?.pid },
    doctorChecks: doctor.checks.map((check) => `${check.name}:${check.status}`),
    portsClosed: { temporal: true, api: true },
    managedOrphans: 0
  };
} finally {
  await supervisor?.stop().catch(() => undefined);
  const externalIdentity = inspector.inspect(externalOpenCode.pid!);
  if (externalIdentity) {
    process.kill(-externalIdentity.pgid, "SIGTERM");
    for (let attempt = 0; attempt < 50 && inspector.matches(externalIdentity); attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    if (inspector.matches(externalIdentity)) process.kill(-externalIdentity.pgid, "SIGKILL");
  }
  await rm(dataRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ ...report, cleanup: "complete" }, null, 2)}\n`);
