import { closeSync, openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const reservePort = async (): Promise<number> => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      reject(new Error("Could not reserve a Temporal POC port"));
      return;
    }
    server.close((error) => error ? reject(error) : resolvePort(address.port));
  });
});

export class TemporalDevServer {
  private child: ChildProcess | undefined;
  private logDescriptor: number | undefined;

  private constructor(
    readonly address: string,
    readonly databaseFile: string,
    readonly logFile: string,
    readonly namespace: string,
    readonly port: number,
    readonly version: string
  ) {}

  static async start(dataRoot: string): Promise<TemporalDevServer> {
    const version = spawnSync("temporal", [
      "--disable-config-file",
      "--disable-config-env",
      "--version"
    ], { encoding: "utf8" });
    if (version.error || version.status !== 0) {
      throw new Error("Temporal CLI is required on PATH for the I6.2 POC");
    }
    const port = await reservePort();
    const temporalRoot = join(dataRoot, "temporal");
    await mkdir(temporalRoot, { recursive: true });
    const server = new TemporalDevServer(
      `127.0.0.1:${port}`,
      join(temporalRoot, "dev-server.db"),
      join(temporalRoot, "server.log"),
      "nodra",
      port,
      version.stdout.trim()
    );
    server.logDescriptor = openSync(server.logFile, "w");
    server.child = spawn("temporal", [
      "--disable-config-file",
      "--disable-config-env",
      "server",
      "start-dev",
      "--headless",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--namespace",
      server.namespace,
      "--db-filename",
      server.databaseFile
    ], {
      stdio: ["ignore", server.logDescriptor, server.logDescriptor]
    });
    try {
      await new Promise<void>((resolveSpawn, reject) => {
        server.child!.once("spawn", resolveSpawn);
        server.child!.once("error", reject);
      });
    } catch (error) {
      if (server.logDescriptor !== undefined) closeSync(server.logDescriptor);
      server.logDescriptor = undefined;
      server.child = undefined;
      throw error;
    }
    return server;
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
        new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 5_000))
      ]);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
      }
    }
    if (this.logDescriptor !== undefined) {
      closeSync(this.logDescriptor);
      this.logDescriptor = undefined;
    }
    this.child = undefined;
  }
}
