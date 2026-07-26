import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@nodra/domain": fromRoot("./packages/domain/src/index.ts"),
      "@nodra/application": fromRoot("./packages/application/src/index.ts"),
      "@nodra/adapters": fromRoot("./packages/adapters/src/index.ts")
    }
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "scripts/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    testTimeout: 15_000
  }
});
