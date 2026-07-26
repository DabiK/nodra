import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { OpenCodeContractProbe } from "../packages/adapters/src/opencode/opencode-contract-probe.js";

interface ExportOptions {
  url: string;
  out: string;
}

const parseOptions = (arguments_: readonly string[]): ExportOptions => {
  let url = process.env.NODRA_OPENCODE_URL ?? "http://127.0.0.1:4096";
  let out = ".artifacts/opencode-server-schema";
  for (let index = 0; index < arguments_.length; index += 1) {
    const value = arguments_[index];
    if (value === "--url" && arguments_[index + 1]) {
      url = arguments_[index + 1]!;
      index += 1;
      continue;
    }
    if (value === "--out" && arguments_[index + 1]) {
      out = arguments_[index + 1]!;
      index += 1;
      continue;
    }
    throw new Error("Usage: opencode:schema:export [--url http://127.0.0.1:<port>] [--out <directory>]");
  }
  const parsed = new URL(url);
  if (
    parsed.protocol !== "http:"
    || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)
  ) {
    throw new Error("OpenCode schema export requires an HTTP loopback server URL");
  }
  return { url: parsed.origin, out: resolve(out) };
};

export const exportOpenCodeServerSchema = async (
  options: ExportOptions
): Promise<{ version: string; digest: string; output: string }> => {
  const snapshot = await new OpenCodeContractProbe(options.url).execute();
  await mkdir(options.out, { recursive: true });
  const extension = snapshot.document.trimStart().startsWith("{") ? "json" : "html";
  await Promise.all([
    writeFile(resolve(options.out, `openapi.${extension}`), snapshot.document, "utf8"),
    writeFile(resolve(options.out, "manifest.json"), JSON.stringify({
      serverUrl: options.url,
      version: snapshot.version,
      sha256: snapshot.digest,
      requiredPrimitives: snapshot.requiredPrimitives,
      exportedAt: new Date().toISOString()
    }, null, 2) + "\n", "utf8")
  ]);
  return { version: snapshot.version, digest: snapshot.digest, output: options.out };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await exportOpenCodeServerSchema(parseOptions(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
