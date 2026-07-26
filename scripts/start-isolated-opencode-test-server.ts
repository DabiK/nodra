import { resolve } from "node:path";
import { OpenCodeTestServer } from "../poc/opencode/opencode-test-server.js";

const dataRoot = process.argv[2];
if (!dataRoot) {
  throw new Error("Usage: tsx scripts/start-isolated-opencode-test-server.ts <temporary-data-root>");
}

const server = await OpenCodeTestServer.start(resolve(dataRoot));
process.stdout.write(`${server.baseUrl}\n`);

let stopping = false;
const stop = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  await server.stop();
  process.exitCode = 0;
};
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });

while (!stopping) {
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
}
