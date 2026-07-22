import type { ManageGates } from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import type { I4CliHandler, I4CliRequest } from "./i4-cli.js";

export class GateCli implements I4CliHandler {
  constructor(private readonly gates: ManageGates) {}
  async execute({ command, args, context }: I4CliRequest) {
    if (command === "gate:bind-pipeline") throw new DomainError("Pipeline gate bindings are unavailable before I8", "CAPABILITY_UNAVAILABLE");
    if (command === "gate:define") { const exitIndex = args.indexOf("--expected-exit"); if (!args[0] || !args[1]) throw new DomainError("gate:define requires mission and name", "CLI_USAGE_ERROR"); const id = toId(randomUUID()); return this.gates.define({ definition: { id, name: args[1], evaluatorId: "command-exit", evaluatorVersion: "1", criteriaSchemaVersion: 1, criteria: { schemaVersion: 1, expectedExitCode: exitIndex < 0 ? 0 : this.integer(args[exitIndex + 1]), requiresGit: args.includes("--requires-git") }, expectedEvidence: { schemaVersion: 1, kind: "observation", collectorId: "nodra.command", collectorVersion: "1" }, createdAt: context.occurredAt }, missionBindingId: toId(randomUUID()), missionId: toId(args[0]), context }); }
    if (command === "gate:evaluate" && args.length >= 3) return this.gates.evaluate({ evaluationId: toId(randomUUID()), bindingId: toId(args[0]!), runId: toId(args[1]!), evidenceIds: args.slice(2).map(toId), context });
    if (command === "gate:list" && args.length === 1) return this.gates.list(toId(args[0]!));
    if (command === "gate:refresh-staleness" && args.length === 1) return this.gates.refreshStaleness({ runId: toId(args[0]!), context });
    if (command === "gate:override" && args.length >= 4 && ["accept", "reject", "waive"].includes(args[2]!)) return this.gates.override({ overrideId: toId(randomUUID()), evaluationId: toId(args[0]!), approvalId: toId(args[1]!), decision: args[2] as "accept"|"reject"|"waive", comment: args.slice(3).join(" "), context });
    return undefined;
  }
  private integer(value: string | undefined) { const number = Number(value); if (!Number.isInteger(number) || number < 0) throw new DomainError("Expected a non-negative integer", "CLI_USAGE_ERROR"); return number; }
}
