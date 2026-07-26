import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:net";

export class OpenCodeTestServer {
  private constructor(
    readonly baseUrl: string,
    private readonly process: ChildProcessWithoutNullStreams,
    private readonly logs: string[]
  ) {}

  static async start(
    dataRoot: string,
    profile: "ollama" | "zen" = "ollama"
  ): Promise<OpenCodeTestServer> {
    const executable = process.env.NODRA_OPENCODE_BINARY
      ?? "/Users/Dabi/.opencode/bin/opencode";
    const port = await this.freePort();
    const home = join(dataRoot, "opencode-home");
    const configDirectory = join(dataRoot, "opencode-config-directory");
    const configFile = join(dataRoot, "opencode.json");
    await Promise.all([
      mkdir(home, { recursive: true }),
      mkdir(configDirectory, { recursive: true })
    ]);
    const config = profile === "zen"
      ? {
          $schema: "https://opencode.ai/config.json",
          model: "opencode/deepseek-v4-flash-free",
          enabled_providers: ["opencode"]
        }
      : {
          $schema: "https://opencode.ai/config.json",
          model: "ollama/gemma3:4b",
          enabled_providers: ["ollama"],
          provider: {
            ollama: {
              npm: "@ai-sdk/openai-compatible",
              name: "Ollama local isolated I8",
              options: {
                baseURL: "http://127.0.0.1:11434/v1"
              },
              models: {
                "gemma3:4b": {
                  name: "Gemma 3 4B"
                }
              }
            }
          }
        };
    await writeFile(configFile, JSON.stringify(config, null, 2) + "\n", "utf8");
    const child = spawn(executable, [
      "serve",
      "--hostname", "127.0.0.1",
      "--port", String(port),
      "--pure",
      "--print-logs"
    ], {
      cwd: dataRoot,
      env: {
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        XDG_DATA_HOME: join(home, ".local", "share"),
        XDG_CACHE_HOME: join(home, ".cache"),
        OPENCODE_CONFIG: configFile,
        OPENCODE_CONFIG_DIR: configDirectory,
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        LANG: process.env.LANG ?? "en_US.UTF-8",
        SHELL: process.env.SHELL ?? "/bin/zsh",
        NO_COLOR: "1"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const logs: string[] = [];
    child.stdout.on("data", (chunk) => logs.push(String(chunk)));
    child.stderr.on("data", (chunk) => logs.push(String(chunk)));
    const server = new OpenCodeTestServer(`http://127.0.0.1:${port}`, child, logs);
    await server.waitUntilHealthy();
    return server;
  }

  async stop(): Promise<void> {
    if (this.process.exitCode !== null) return;
    this.process.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => this.process.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000))
    ]);
    if (this.process.exitCode === null) this.process.kill("SIGKILL");
  }

  diagnostic(): string {
    return this.logs.join("").slice(-8_000);
  }

  private async waitUntilHealthy(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (this.process.exitCode !== null) {
        throw new Error(`OpenCode Serve exited during startup:\n${this.diagnostic()}`);
      }
      try {
        const response = await fetch(`${this.baseUrl}/global/health`);
        if (response.ok) return;
      } catch {
        // Startup polling is bounded and targets loopback only.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`OpenCode Serve did not become healthy:\n${this.diagnostic()}`);
  }

  private static freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          reject(new Error("Unable to allocate an OpenCode loopback port"));
          return;
        }
        const port = address.port;
        server.close((error) => error ? reject(error) : resolve(port));
      });
    });
  }
}
