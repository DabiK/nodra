#!/usr/bin/env node

/* global __dirname, process, require */
/* eslint-disable @typescript-eslint/no-require-imports */

const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");
const result = spawnSync(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "apps/cli/src/main.ts", ...process.argv.slice(2)],
  { cwd: root, stdio: "inherit" }
);

process.exitCode = result.status ?? 1;
