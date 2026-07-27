import { RuntimeError } from "./runtime-errors.js";

/**
 * The runtime supervisor manages long-lived child processes as Unix process
 * groups (`detached` group leaders + `process.kill(-pgid, signal)`) and inspects
 * them with `ps`/`lsof`. None of that exists on native Windows, so the
 * supervisor is only supported on POSIX platforms (macOS, Linux, and Windows via
 * WSL2). Individual components can still be started manually on native Windows.
 */
export function assertPosixRuntime(platform: NodeJS.Platform = process.platform): void {
  if (platform === "win32") {
    throw new RuntimeError(
      "The runtime supervisor (runtime:start/stop/status) is not supported on native Windows "
      + "because it relies on Unix process groups and the `ps`/`lsof` tools. "
      + "Run it under WSL2, or start the components manually (see the Windows section of the README).",
      "RUNTIME_PLATFORM_UNSUPPORTED"
    );
  }
}
