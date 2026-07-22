import type { ManageDelivery } from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import type { I4CliHandler, I4CliRequest } from "./i4-cli.js";

export class DeliveryCli implements I4CliHandler {
  constructor(private readonly delivery: ManageDelivery) {}
  async execute({ command, args, context }: I4CliRequest) {
    if (command === "delivery:show" && args.length === 1) return this.delivery.show(toId(args[0]!));
    if (command === "delivery:declare" && args.length >= 4) return this.delivery.declare({ id: toId(randomUUID()), runId: toId(args[0]!), expectedMissionVersion: this.version(args[1]), agentDeclaration: args[2]!, observationSummary: args.slice(3).join(" "), context });
    if (!["delivery:accept", "delivery:request-changes", "delivery:reject"].includes(command)) return undefined;
    if (args.length < 3) throw new DomainError("Invalid delivery decision arguments", "CLI_USAGE_ERROR");
    return this.delivery.decide({ runId: toId(args[0]!), expectedMissionVersion: this.version(args[1]), decision: command.slice("delivery:".length) as "accept"|"request-changes"|"reject", comment: args.slice(2).join(" "), context });
  }
  private version(value: string | undefined) { const number = Number(value); if (!Number.isInteger(number) || number < 0) throw new DomainError("Expected a non-negative integer", "CLI_USAGE_ERROR"); return number; }
}
