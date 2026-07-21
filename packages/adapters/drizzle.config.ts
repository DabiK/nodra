import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./packages/adapters/src/sqlite/schema/index.ts",
  out: "./packages/adapters/drizzle",
  strict: true,
  verbose: true
});
