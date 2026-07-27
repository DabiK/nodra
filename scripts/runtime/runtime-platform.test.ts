import { describe, expect, it } from "vitest";
import { assertPosixRuntime } from "./runtime-platform.js";

describe("assertPosixRuntime", () => {
  it("allows POSIX platforms", () => {
    expect(() => assertPosixRuntime("darwin")).not.toThrow();
    expect(() => assertPosixRuntime("linux")).not.toThrow();
  });

  it("rejects native Windows with an actionable error", () => {
    try {
      assertPosixRuntime("win32");
      throw new Error("expected assertPosixRuntime to throw on win32");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("RUNTIME_PLATFORM_UNSUPPORTED");
      expect((error as Error).message).toMatch(/WSL2/);
    }
  });
});
