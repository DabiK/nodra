import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { RuntimeError } from "./runtime-errors.js";
import { ProcessInspector } from "./process-inspector.js";
import type { RuntimeManifest } from "./runtime-types.js";

export class RuntimeManifestStore {
  readonly manifestFile: string;
  private readonly lockFile: string;
  private readonly inspector = new ProcessInspector();

  constructor(private readonly runtimeRoot: string) {
    this.manifestFile = join(runtimeRoot, "runtime-state.json");
    this.lockFile = join(runtimeRoot, "runtime.lock");
  }

  async read(): Promise<RuntimeManifest | null> {
    try {
      const value = JSON.parse(await readFile(this.manifestFile, "utf8")) as RuntimeManifest;
      if (value.schemaVersion !== 1 || !value.runtimeId || !value.components) {
        throw new Error("unsupported manifest shape");
      }
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new RuntimeError(
        `Cannot read runtime manifest: ${error instanceof Error ? error.message : String(error)}`,
        "RUNTIME_MANIFEST_INVALID"
      );
    }
  }

  async write(manifest: RuntimeManifest): Promise<void> {
    await mkdir(this.runtimeRoot, { recursive: true, mode: 0o700 });
    const temporary = `${this.manifestFile}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(manifest, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporary, this.manifestFile);
  }

  async archiveStale(): Promise<string | null> {
    try {
      const destination = join(
        dirname(this.manifestFile),
        `runtime-state.stale-${new Date().toISOString().replaceAll(":", "-")}.json`
      );
      await rename(this.manifestFile, destination);
      return destination;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async remove(): Promise<void> {
    await unlink(this.manifestFile).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.runtimeRoot, { recursive: true, mode: 0o700 });
    const handle = await this.acquireLock();
    try {
      return await operation();
    } finally {
      await handle.close();
      await unlink(this.lockFile).catch(() => undefined);
    }
  }

  private async acquireLock(): Promise<FileHandle> {
    try {
      const handle = await open(this.lockFile, "wx", 0o600);
      const identity = this.inspector.inspect(process.pid);
      await handle.writeFile(JSON.stringify({
        pid: process.pid,
        at: new Date().toISOString(),
        identity
      }));
      return handle;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stale = await this.lockIsStale();
      if (!stale) {
        throw new RuntimeError(
          `Runtime operation already in progress; inspect ${this.lockFile}`,
          "RUNTIME_LOCKED"
        );
      }
      await rename(
        this.lockFile,
        `${this.lockFile}.stale-${new Date().toISOString().replaceAll(":", "-")}`
      );
      return this.acquireLock();
    }
  }

  private async lockIsStale(): Promise<boolean> {
    try {
      const value = JSON.parse(await readFile(this.lockFile, "utf8")) as {
        identity?: ReturnType<ProcessInspector["inspect"]>;
      };
      return !value.identity || !this.inspector.matches(value.identity);
    } catch {
      return true;
    }
  }
}
