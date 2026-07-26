import { spawnSync } from "node:child_process";
import { Connection } from "@temporalio/client";
import { readTemporalLocalConfig } from "./temporal-local-config.js";

const config = readTemporalLocalConfig();
const version = spawnSync("temporal", ["--disable-config-file", "--disable-config-env", "--version"], {
  encoding: "utf8"
});
if (version.error || version.status !== 0) {
  process.stdout.write(`${JSON.stringify({
    status: "error",
    components: {
      cli: { status: "error", detail: "Temporal CLI is absent from PATH" },
      server: { status: "error" },
      namespace: { status: "error", name: config.namespace },
      workflow: { status: "error" }
    }
  }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  let connection: Connection | undefined;
  let server: "ok" | "error" = "error";
  let namespace: "ok" | "error" = "error";
  try {
    connection = await Connection.connect({ address: config.address, connectTimeout: 1_000 });
    await connection.withDeadline(Date.now() + 1_000, () =>
      connection!.workflowService.getSystemInfo({})
    );
    server = "ok";
    await connection.withDeadline(Date.now() + 1_000, () =>
      connection!.workflowService.describeNamespace({ namespace: config.namespace })
    );
    namespace = "ok";
  } catch {
    process.exitCode = 1;
  } finally {
    await connection?.close();
  }
  const workflow = server === "ok" && namespace === "ok" ? "ok" : "error";
  process.stdout.write(`${JSON.stringify({
    status: workflow,
    config: {
      address: config.address,
      namespace: config.namespace,
      dataRoot: config.dataRoot,
      databaseFile: config.databaseFile
    },
    components: {
      cli: { status: "ok", version: version.stdout.trim() },
      server: { status: server },
      namespace: { status: namespace, name: config.namespace },
      workflow: { status: workflow }
    }
  }, null, 2)}\n`);
}
