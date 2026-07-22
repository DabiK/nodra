import type { CollectEvidence, ReadEvidence } from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import type { I4CliHandler, I4CliRequest } from "./i4-cli.js";

export class EvidenceCli implements I4CliHandler {
  constructor(private readonly evidence: ReadEvidence, private readonly collect: CollectEvidence) {}
  async execute({ command, args, context }: I4CliRequest) {
    if (command === "evidence:list" && args.length === 1) return this.evidence.list(toId(args[0]!));
    if (command === "evidence:show" && args.length === 1) return this.evidence.show(toId(args[0]!));
    if (command === "evidence:collect-git" && args.length === 1) return this.collect.gitObservation({ evidenceId: toId(randomUUID()), runId: toId(args[0]!), context });
    if (command !== "evidence:collect-command") return undefined;
    const separator = args.indexOf("--"); const cwdIndex = args.indexOf("--cwd");
    if (separator < 0 || cwdIndex < 0 || !args[0] || !args[cwdIndex + 1] || separator === args.length - 1) throw new DomainError("collect-command requires run, --cwd and -- argv", "CLI_USAGE_ERROR");
    const timeoutIndex = args.indexOf("--timeout"); const capIndex = args.indexOf("--max-output");
    return this.collect.command({ evidenceId: toId(randomUUID()), runId: toId(args[0]), cwd: args[cwdIndex + 1]!, argv: args.slice(separator + 1), timeoutMs: timeoutIndex < 0 ? 30_000 : this.integer(args[timeoutIndex + 1]), maxOutputBytes: capIndex < 0 ? 1_000_000 : this.integer(args[capIndex + 1]), context });
  }
  private integer(value: string | undefined) { const number = Number(value); if (!Number.isInteger(number) || number < 0) throw new DomainError("Expected a non-negative integer", "CLI_USAGE_ERROR"); return number; }
}
