import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface SchemaCommandRunner {
  run(command: string, arguments_: readonly string[]): Promise<void>;
}

const localSchemaCommandRunner: SchemaCommandRunner = {
  async run(command, arguments_) {
    await new Promise<void>((resolveRun, reject) => {
      const child = spawn(command, arguments_, {
        stdio: ["ignore", "inherit", "inherit"],
        env: process.env
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) {
          resolveRun();
          return;
        }
        reject(new Error(
          `${command} exited while exporting schemas (code=${String(code)}, signal=${String(signal)})`
        ));
      });
    });
  }
};

export class CodexSchemaExporter {
  constructor(private readonly runner: SchemaCommandRunner = localSchemaCommandRunner) {}

  async export(outputDirectory: string): Promise<{
    outputDirectory: string;
    typescriptDirectory: string;
    jsonSchemaDirectory: string;
  }> {
    const target = resolve(outputDirectory);
    const typescriptDirectory = resolve(target, "typescript");
    const jsonSchemaDirectory = resolve(target, "json-schema");
    await Promise.all([
      mkdir(typescriptDirectory, { recursive: true }),
      mkdir(jsonSchemaDirectory, { recursive: true })
    ]);
    await this.runner.run("codex", [
      "app-server",
      "generate-ts",
      "--out",
      typescriptDirectory
    ]);
    await this.runner.run("codex", [
      "app-server",
      "generate-json-schema",
      "--out",
      jsonSchemaDirectory
    ]);
    return { outputDirectory: target, typescriptDirectory, jsonSchemaDirectory };
  }
}

export const parseOutputDirectory = (arguments_: readonly string[]): string => {
  if (arguments_.length === 0) return ".artifacts/codex-app-server-schema";
  if (arguments_.length === 2 && arguments_[0] === "--out" && arguments_[1]?.trim()) {
    return arguments_[1];
  }
  throw new Error(
    "Usage: npm run codex:schema:export -- [--out <directory>]"
  );
};

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entrypoint === import.meta.url) {
  const output = parseOutputDirectory(process.argv.slice(2));
  const result = await new CodexSchemaExporter().export(output);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
